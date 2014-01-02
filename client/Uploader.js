"use strict";

// Control all the upload activity

var Uploader = new (require("events").EventEmitter)
module.exports = Uploader

var fs = require("fs")
var net = require("net")
var path = require("path")
var crypto = require("crypto")
var aP = require("async-protocol")
var Tree = require("./Tree.js")

var UPDATE = 0
var REMOVE = 1
var CHUNK_SIZE = 1*1024*1024 // 1 MiB

// Async-protocol definitions
var E_NOT_LOGGED_IN = aP.registerException(1)
var E_OUT_OF_SPACE = aP.registerException(2)
var E_INVALID_SESSION = aP.registerException(3)
var E_LOGIN_ERROR = aP.registerException(4)
var E_WRONG_SIZE = aP.registerException(5)
var E_CORRUPTED_DATA = aP.registerException(6)

var CC_LOGIN = aP.registerClientCall(1, "st", "", [E_LOGIN_ERROR])
var CC_START_UPLOAD = aP.registerClientCall(2, "BuuB", "s", [E_NOT_LOGGED_IN, E_OUT_OF_SPACE])
var CC_START_CHUNK_UPLOAD = aP.registerClientCall(3, "sB", "s", [E_NOT_LOGGED_IN, E_INVALID_SESSION])
var CC_COMMIT_CHUNK = aP.registerClientCall(4, "s", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_CORRUPTED_DATA])
var CC_CANCEL_UPLOAD = aP.registerClientCall(5, "s", "", [E_NOT_LOGGED_IN])
var CC_COMMIT_UPLOAD = aP.registerClientCall(6, "s", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_WRONG_SIZE])
var CC_REMOVE_FILE = aP.registerClientCall(7, "B", "", [E_NOT_LOGGED_IN])
var CC_GET_FILES_INFO = aP.registerClientCall(8, "", "(B(uus))", [E_NOT_LOGGED_IN])
var CC_GET_QUOTA_USAGE = aP.registerClientCall(9, "", "uuu")

// Start the upload
// config is an object with the keys "dumpFile", "host", "port", "uploadPort", "userName", "reconnectionTime", "loginKey", "aesKey", "aesIV", "maxUploadSpeed"
// This object emits update() whenever the internal status change (check getStatus())
Uploader.start = function (config) {
	_config = config
	fs.readFile(_config.dumpFile, {encoding: "utf8"}, function (err, data) {
		if (_started)
			throw new Error("Uploader has already been started")
		if (err) {
			// Create a new dump file
			console.log("[Uploader] creating dump file: "+_config.dumpFile)
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
		queueLength: _tree.getAllFiles().length,
		file: "",
		size: 0,
		progress: 0
	}
	if (_uploading) {
		status.file = _uploading.file
		status.size = _uploading.size
		status.progress = CHUNK_SIZE*_uploading.sentChunks/_uploading.size
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
		conn.sendCall(CC_GET_FILES_INFO, null, function (files) {
			conn.close()
			
			// Decrypt all file names
			var tree = new Tree
			files.forEach(function (file) {
				// Decrypt
				var decipher = crypto.createDecipheriv("aes128", _config.aesKey, _config.aesIV)
				decipher.end(file[0])
				var filePath = decipher.read().toString()
				
				// Store in the tree
				var folderPath = path.dirname(filePath)
				var folder = tree.getFolder(folderPath)
				folder.setFileInfo(path.basename(filePath), file[1].map(function (each) {
					return {size: each[0], mtime: each[1], id: each[2]}
				}))
			})
			
			callback(tree.toJSON())
		}, function () {
			conn.close()
			callback(null)
		})
	})
}

// Return an copy of the internal tree
// Each leaf is an int to indicate the kind of operation is scheduled for the file
// 0 means UPDATE, 1 REMOVE
Uploader.getTree = function () {
	return _tree.toJSON()
}

// Ask the server about the current quota usage
// callback(result) will be called with an object with the keys "total", "free", "softUse"
// If the server couldn't be reached, result will be null
Uploader.getQuotaUsage = function (callback) {
	connect(function (conn) {
		if (!conn)
			return callback(null)
		conn.sendCall(CC_GET_QUOTA_USAGE, null, function (total, free, softUse) {
			callback({total: total, free: free, softUse: softUse})
			conn.close()
		}, function () {
			callback(null)
			conn.close()
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

// Try to connect with the backuper server
// callback(conn) isn't optional and will be called after the login
// If something went wrong, conn will be null
function connect(callback) {
	var conn = net.connect({port: _config.port, host: _config.host})
	conn.once("error", function () {
		callback(null)
	})
	conn.once("connect", function () {
		conn.removeAllListeners()
		conn = new aP(conn, true)
		var data = new aP.Data().addString(_config.userName).addToken(_config.loginKey)
		conn.sendCall(CC_LOGIN, data, function () {
			callback(conn)
		}, function () {
			console.log("[Uploader] login failed")
			callback(null)
			conn.close()
		})
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
	
	if (mode == REMOVE) {
		// Send the remove command to the server
		_conn.sendCall(CC_REMOVE_FILE, new aP.Data().addBuffer(encodeFilePath(file.fullPath)), function () {
			file.folder.removeItem(file.fileName)
			saveData()
			stepUploadSequence()
		}, function () {
			stepUploadSequence()
		})
	} else if (mode == UPDATE) {
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
		_uploading = null
		saveData()
		stepUploadSequence()
	})
	source.pipe(hash)
	hash.once("readable", function () {
		var data = new aP.Data
		
		if (!fine || !_conn)
			// Things went wrong in the mean time
			return
		
		// Create the data package (Buffer filePath, uint mtime, uint size, Buffer originalHash)
		data.addBuffer(encodeFilePath(_uploading.file))
			.addUint(_uploading.mtime)
			.addUint(_uploading.size)
			.addBuffer(hash.read())
		
		// Send
		_conn.sendCall(CC_START_UPLOAD, data, function (id) {
			// Save the session id and continue the process
			_uploading.id = id
			console.log("[Uploader] upload session %s for %s", id, _uploading.file)
			saveData()
			stepUploadSequence()
		}, function (type) {
			// Error, drop the connection
			if (type == E_OUT_OF_SPACE)
				console.log("[Uploader] out of space in the server")
			if (_conn)
				_conn.close()
		})
	})
}

// Load the next chunk and start the chunk upload session
function startNewChunkUpload() {
	var ignoreForNow = function () {
		// Put the file back in the queue
		if (_conn)
			_conn.sendCall(CC_CANCEL_UPLOAD, _uploading.id)
		setFileInfo(_uploading.file, UPDATE)
		_uploading = null
		stepUploadSequence()
	}
	
	var stats
	try {
		// Check for changes
		stats = fs.statSync(_uploading.file)
		if (stats.size != _uploading.size || hashDate(stats.mtime) != _uploading.mtime) {
			// Ignore this file
			if (_conn)
				_conn.sendCall(CC_CANCEL_UPLOAD, _uploading.id)
			_uploading = null
			saveData()
			stepUploadSequence()
			return
		}
	} catch (e) {
		return ignoreForNow()
	}
	
	// Load and encrypt the chunk
	fs.open(_uploading.file, "r", function (err, fd) {
		if (err) return ignoreForNow()
		fs.read(fd, new Buffer(CHUNK_SIZE), 0, CHUNK_SIZE, _uploading.sentChunks*CHUNK_SIZE, function (err, bytesRead, buffer) {
			fs.close(fd, function () {})
			if (err) return ignoreForNow()
			
			// Encode the buffer and start the chunk session
			buffer = encodeBuffer(buffer.slice(0, bytesRead))
			var data = new aP.Data().addString(_uploading.id).addBuffer(sha1(buffer))
			if (!_conn) return
			_conn.sendCall(CC_START_CHUNK_UPLOAD, data, function (chunkId) {
				uploadChunk(buffer, chunkId)
			}, function (type) {
				if (type == E_INVALID_SESSION)
					ignoreForNow()
			})
		})
	})
}

// Open an auxiliary connection and send the encoded chunk
function uploadChunk(encodedChunk, chunkId) {
	var conn, nextTime
	
	// Get the minimum time when the next chunk upload should start
	nextTime = Date.now()+8*(encodedChunk.length+32)/_config.maxUploadSpeed
	var continueUpload = function () {
		var delta = nextTime-Date.now()
		if (delta > 0)
			setTimeout(stepUploadSequence, delta)
		else
			stepUploadSequence()
	}
	
	// Open a new connection and send the data
	conn = net.connect({port: _config.uploadPort, host: _config.host})
	conn.once("connect", function () {
		conn.write(chunkId)
		conn.end(encodedChunk)
	})
	conn.once("error", function () {})
	conn.once("close", function () {
		if (conn.bytesWritten != 32+encodedChunk.length)
			// Try to send the chunk again
			continueUpload()
		else if (_conn) {
			// Check chunk status
			_conn.sendCall(CC_COMMIT_CHUNK, new aP.Data().addString(chunkId), function () {
				// Chunk uploaded sucessfuly
				_uploading.sentChunks++
				saveData()
				continueUpload()
			}, function () {
				// Try to send chunk again
				continueUpload()
			})
		}
	})
}

// Finish the upload process
function endUpload() {
	if (!_conn) return
	_conn.sendCall(CC_COMMIT_UPLOAD, _uploading.id, function () {
		// Fine, done!
		_uploading = null
		saveData()
		stepUploadSequence()
	}, function (type) {
		// Something went wrong, put the file back in the queue
		console.log("[Uploader] fatal error on file upload: "+type)
		setFileInfo(_uploading.file, UPDATE)
		_uploading = null
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
			fs.writeFileSync(_config.dumpFile, JSON.stringify(data))
		} catch (e) {
			console.log("[Uploader] Error while trying to save data into "+_config.dumpFile)
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
	cipher.end(filePath)
	return cipher.read()
}

// Encrypt the given buffer with the user key and the given initialization vector (16-byte buffer)
function encodeBufferWithIV(buffer, iv) {
	var cipher = crypto.createCipheriv("aes128", _config.aesKey, iv)
	cipher.end(buffer)
	buffer = cipher.read()
	return Buffer.concat([iv, buffer], iv.length+buffer.length)
}
