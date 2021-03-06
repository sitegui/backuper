"use strict"

// Control all the upload activity

var Uploader = new (require("events").EventEmitter)
module.exports = Uploader

var fs = require("fs")
var path = require("path")
var crypto = require("crypto")
var Tree = require("./Tree.js")
var connect = require("./connect.js")
var _dumpFile = "uploader.dump"

var UPDATE = 0
var REMOVE = 1
var CHUNK_SIZE = 1*1024*1024 // 1 MiB

// Start the upload
// config is an object with the keys "uploadPort", "reconnectionTime", "aesKey", "aesIV", "maxUploadSpeed"
// This object emits update() whenever the internal status change (check getStatus())
// Emits ignoreFile(file) whenever a given file could not be processed now (like when it's locked)
Uploader.start = function (config) {
	_config = config
	fs.readFile(_dumpFile, {encoding: "utf8"}, function (err, data) {
		if (_started)
			throw new Error("Uploader has already been started")
		if (err) {
			// Create a new dump file
			console.log("[Uploader] creating dump file: "+_dumpFile)
			_tree = new Tree
			_uploading = null
			saveData()
		} else {
			// Get the saved data
			data = JSON.parse(data)
			if (data.format != 1)
				throw new Error("Invalid format")
			_tree = new Tree(data.tree)
			_uploading = data.uploading
		}
		_started = true
		Uploader.emit("start")
		kickIn()
		setInterval(kickIn, _config.reconnectionTime)
	})
}

Uploader.queueFileUpdate = function (file) {
	setFileInfo(file, UPDATE)
}

Uploader.queueFileRemove = function (file) {
	setFileInfo(file, REMOVE)
}

// Return {connected: bool, queueLength: uint, file: string, size: uint, progress: float}
// If idle, file will be an empty string
Uploader.getStatus = function () {
	var status = {
		connected: Boolean(_conn),
		queueLength: _tree.getNumFiles(),
		file: "",
		size: 0,
		progress: 0
	}
	if (_uploading) {
		status.file = _uploading.file
		status.size = _uploading.size
		status.progress = Math.min(1, CHUNK_SIZE*_uploading.sentChunks/_uploading.size)
	}
	return status
}

// Return the tree of files in the server
// This is an expensive operation!
// callback(tree) will be called with the result (or null in case of error)
Uploader.getServerTree = function (callback) {
	connect(function (conn) {
		if (!conn)
			return callback(null)
		
		conn.call("getFilesInfo", null, function (err, result) {
			conn.close()
			if (err)
				return callback(null)
			
			// Decrypt all file names
			var tree = new Tree
			result.files.forEach(function (file) {
				// Decrypt
				var decipher = crypto.createDecipheriv("aes128", _config.aesKey, _config.aesIV)
				decipher.end(file.path)
				var filePath = decipher.read().toString()
				
				// Store in the tree
				var folderPath = path.dirname(filePath)
				var folder = tree.getFolder(folderPath)
				folder.setFileInfo(path.basename(filePath), file.versions)
			})
			
			callback(tree.toJSON())
		})
	})
}

// Return an copy of the internal tree
// Each leaf is an int to indicate the kind of operation is scheduled for the file
// 0 means UPDATE, 1 REMOVE
Uploader.getTree = function () {
	_tree.clear()
	return _tree.toJSON()
}

// Ask the server about the current quota usage
// callback(result) will be called with an object with the keys "total", "free", "softUse"
// If the server couldn't be reached, result will be null
Uploader.getQuotaUsage = function (callback) {
	connect(function (conn) {
		if (!conn)
			return callback(null)
		conn.call("getQuotaUsage", null, function (err, result) {
			conn.close()
			callback(result)
		})
	})
}

/*
Internals
*/

var _config
var _started = false
var _conn // the async-protocol connection
var _tree // files queued to update
var _uploading // null if idle, an object with keys "id", "file", "mtime", "size", "sentChunks" otherwise

// Aux function for queueFileUpdate and queueFileRemove
function setFileInfo(file, info) {
	var folder, parts
	
	if (!_started)
		throw new Error("Uploader hasn't started")
	
	parts = file.split(path.sep)
	file = parts.pop()
	folder = _tree.getFolder(parts.join(path.sep))
	folder.setFileInfo(file, info)
	saveData()
}

// Start the whole upload process
// Store the connection in the global var _conn
function kickIn() {
	if (_conn)
		// Already connected
		return
	if (!_uploading && _tree.isEmpty())
		// There is no work to do
		return
	connect(function (conn) {
		if (conn) {
			_conn = conn
			_conn.once("close", function () {
				_conn = null
				_tree.clear()
			})
			stepUploadSequence()
		}
	})
}

// Do a single step in the upload process
function stepUploadSequence() {
	if (!_conn)
		return
	else if (!_uploading)
		pickFileToUpload()
	else if (!_uploading.id)
		createUploadSession()
	else if (_uploading.sentChunks*CHUNK_SIZE < _uploading.size)
		startNewChunkUpload()
	else
		endUpload()
}

// First step in the upload process
// Extract a file from the queue
function pickFileToUpload() {
	var file, mode
	
	// Pick any file in the update tree
	file = _tree.getAnyFile()
	if (!file) {
		// No more files to play with, just close the connection
		_conn.close()
		return
	}
	
	mode = file.folder.getFileInfo(file.fileName)
	
	if (mode == REMOVE)
		// Send the remove command to the server
		_conn.call("removeFile", {filePath: encodeFilePath(file.fullPath)}, function (err) {
			if (!err) {
				file.folder.removeItem(file.fileName)
				saveData()
			}
			stepUploadSequence()
		})
	else if (mode == UPDATE) {
		// Get all data from the last file
		// Don't extract it right away, wait for the stat response
		fs.stat(file.fullPath, function (err, stats) {
			if (!err) {
				_uploading = {}
				_uploading.id = null
				_uploading.file = file.fullPath
				_uploading.size = stats.size
				_uploading.mtime = hashDate(stats.mtime)
				_uploading.sentChunks = 0
			}
			file.folder.removeItem(file.fileName)
			saveData()
			stepUploadSequence()
		})
	}
}

// Second step in the upload process
// Create a upload session in the server
function createUploadSession() {
	// Get the original hash
	var hash = crypto.createHash("sha1")
	var source = fs.createReadStream(_uploading.file)
	var fine = true
	source.once("error", function () {
		// Ignore this file
		fine = false
		Uploader.emit("ignoreFile", _uploading.file)
		_uploading = null
		saveData()
		stepUploadSequence()
	})
	source.pipe(hash)
	hash.once("readable", function () {
		if (!fine || !_conn)
			// Things went wrong in the mean time
			return
		
		// Create the data package (filePath: Buffer, mtime: int, size: uint, originalHash: Buffer)
		var data = {
			filePath: encodeFilePath(_uploading.file),
			mtime: _uploading.mtime,
			size: _uploading.size,
			originalHash: hash.read()
		}
		
		// Send
		_conn.call("startUpload", data, function (err, result) {
			if (err) {
				if (err.name === "alreadyUploaded") {
					// Already there, that's ok. Continue with a new file
					_uploading = null
					saveData()
					stepUploadSequence()
				} else {
					// Error, drop the connection
					if (err.name === "outOfSpace")
						console.log("[Uploader] out of space in the server")
					this.close()
				}
				return
			}
			
			// Save the session id and continue the process
			_uploading.id = result.uploadId
			console.log("[Uploader] upload session %s for %s", _uploading.id, _uploading.file)
			saveData()
			stepUploadSequence()
		})
	})
}

// Load the next chunk and start the chunk upload session
function startNewChunkUpload() {
	var ignoreForNow = function () {
		// Put the file back in the queue and stop the process for now
		if (_conn)
			_conn.call("cancelUpload", {id: _uploading.id})
		
		Uploader.emit("ignoreFile", _uploading.file)
		_uploading = null
		saveData()
		stepUploadSequence()
	}
	var stats
	
	try {
		// Check for changes
		stats = fs.statSync(_uploading.file)
		if (stats.size != _uploading.size || hashDate(stats.mtime) != _uploading.mtime)
			return ignoreForNow()
	} catch (e) {
		return ignoreForNow()
	}
	
	// Load and encrypt the chunk
	fs.open(_uploading.file, "r", function (err, fd) {
		if (err) return ignoreForNow()
		fs.read(fd, new Buffer(CHUNK_SIZE), 0, CHUNK_SIZE, _uploading.sentChunks*CHUNK_SIZE, function (err, bytesRead, buffer) {
			fs.close(fd, function () {})
			if (err) return ignoreForNow()
			
			// Encode the buffer and start the chunk upload
			buffer = encodeBuffer(buffer.slice(0, bytesRead))
			uploadChunk(buffer)
		})
	})
}

// Send the encoded chunk
function uploadChunk(encodedChunk) {
	// Get the minimum time when the next chunk upload should start
	var nextTime
	if (_config.maxUploadSpeed)
		nextTime = Date.now()+8*(encodedChunk.length+32)/_config.maxUploadSpeed
	else
		nextTime = Date.now()
	var continueUpload = function () {
		var delta = nextTime-Date.now()
		if (delta > 0)
			setTimeout(stepUploadSequence, delta)
		else
			stepUploadSequence()
	}
	
	// Send the data
	var data = {uploadId: _uploading.id, hash: sha1(encodedChunk), chunk: encodedChunk}
	if (!_conn) return
	_conn.call("uploadChunk", data, function (err) {
		if (!err) {
			// Chunk uploaded sucessfuly
			_uploading.sentChunks++
			saveData()
			continueUpload()
		} else if (err.name == "invalidSession") {
			// Put the file back in the queue and stop the process for now
			if (_conn) {
				_conn.call("cancelUpload", {id: _uploading.id})
				_conn.close()
			}
			setFileInfo(_uploading.file, UPDATE)
			saveData()
			_uploading = null
		} else
			// Try again
			continueUpload()
	}, 5*60e3)
}

// Finish the upload process
function endUpload() {
	if (!_conn) return
	_conn.call("commitUpload", {id: _uploading.id}, function (err) {
		if (err) {
			// Something went wrong, put the file back in the queue
			console.log("[Uploader] fatal error on file upload: "+err.name)
			setFileInfo(_uploading.file, UPDATE)
		}
		_uploading = null
		saveData()
		stepUploadSequence()
	})
}

// Save the current data into the disk
// Delay the command in 100ms to avoid acessing to much the disk
var saveData = (function () {
	var interval = null
	
	var doSave = function () {
		var data = {}
		data.format = 1
		data.tree = _tree
		data.uploading = _uploading
		try {
			fs.writeFileSync(_dumpFile, JSON.stringify(data))
		} catch (e) {
			console.log("[Uploader] Error while trying to save data into "+_dumpFile)
		}
		interval = null
	}
	
	return function () {
		Uploader.emit("update")
		if (interval)
			clearTimeout(interval)
		interval = setTimeout(doSave, 100)
	}
})()

// Convert a date to a number (based on UTC time)
function hashDate(date) {
	var d, m, y, h, i
	d = date.getUTCDate()
	m = date.getUTCMonth()
	y = date.getUTCFullYear()-1990
	h = date.getUTCHours()
	i = date.getUTCMinutes()
	return i+60*(h+24*(d+31*(m+12*y)))
}

// Encode the given buffer
function encodeBuffer(buffer) {
	var iv = new Buffer(16), i
	for (i=0; i<16; i++)
		iv[i] = Math.floor(Math.random()*256)
	return encodeBufferWithIV(buffer, iv)
}

// Return the SHA1 hash of the given buffer
function sha1(buffer) {
	var hash = crypto.createHash("sha1")
	hash.end(buffer)
	return hash.read()
}

// Return an encrypted buffer for the given file path
function encodeFilePath(filePath) {
	var cipher = crypto.createCipheriv("aes128", _config.aesKey, _config.aesIV)
	cipher.end(new Buffer(filePath))
	return cipher.read()
}

// Encrypt the given buffer with the user key and the given initialization vector (16-byte buffer)
function encodeBufferWithIV(buffer, iv) {
	var cipher = crypto.createCipheriv("aes128", _config.aesKey, iv)
	cipher.end(buffer)
	buffer = cipher.read()
	return Buffer.concat([iv, buffer], iv.length+buffer.length)
}
