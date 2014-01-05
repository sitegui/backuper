"use strict"

// Control restore tasks

var Downloader = new (require("events").EventEmitter)
module.exports = Downloader

var net = require("net")
var fs = require("fs")
var Tree = require("./Tree.js")
var connect = require("./connect.js")
var aP = require("async-protocol")
var crypto = require("crypto")

var E_NOT_FOUND = aP.registerException(7)
var CC_REQUEST_FILE_DOWNLOAD = aP.registerClientCall(10, "s", "tuB", [E_NOT_FOUND])

// Start the restore
// It'll awake from the saved state (or start from scratch if it doesn't exist)
// config is an object with the keys "dumpFile", "downloadPort", "reconnectionTime", "aesKey"
// This object emits update() whenever the internal status change (check getStatus())
Downloader.start = function (config) {
	_config = config
	fs.readFile(_config.dumpFile, {encoding: "utf8"}, function (err, data) {
		if (_started)
			throw new Error("Downloader has already been started")
		if (err) {
			// Create a new file watcher profile
			console.log("[Downloader] creating dump file: "+_config.dumpFile)
			_tasks = {}
			_hasWork = false
			saveData()
		} else {
			// Get the data from the saved format
			data = JSON.parse(data)
			if (data.format == 1) {
				_tasks = data.tasks
				// Inflate the trees
				Object.keys(_tasks).forEach(function (taskId) {
					var task = _tasks[taskId]
					task.files = new Tree(task.files)
					// Remove completed tasks
					if (task.files.isEmpty())
						delete _tasks[taskId]
					else
						_hasWork = true
				})
			} else
				throw new Error("Invalid format")
		}
		_started = true
		reconnect()
		setInterval(reconnect, _config.reconnectionTime)
	})
}

/*
Internals
*/

var _config
var _started = false
var _tasks // An object in which values are objects like {destination: string, files: Tree, errors[]: string} indexed by the task id
var _conn = null
var _hasWork // whether there is work to be done
var _task // current task
var _file // null or an object with keys "fullPath", "folder", "fileName"
var _hashFailed = false

function throwErr(err) {
	if (err)
		throw err
}

// Try to connect and start the whole download process
// Store the connection in the global var _conn
function reconnect() {
	if (_conn || !_hasWork)
		// Not need to continue
		return
	connect(function (conn) {
		if (conn) {
			_conn = conn
			_conn.once("close", function () {
				_conn = null
			})
			startDownload()
		}
	})
}

// First step: pick a file and get metadata from the server
function startDownload() {
	var taskId, uploadId
	
	// Pick a file to download
	for (taskId in _tasks) {
		_task = _tasks[taskId]
		_file = _task.files.getAnyFile()
		if (_file)
			break
	}
	if (!_file) {
		// Work completed
		_conn.close()
		_hasWork = false
		return
	}
	uploadId = _file.folder.getFileInfo(_file.fileName)
	
	// Get metadata
	if (_conn)
		_conn.sendCall(CC_REQUEST_FILE_DOWNLOAD, uploadId, function (data) {
			_hashFailed = false
			download(data[0], data[1], uploadId, data[2])
		}, function (type) {
			if (type == E_NOT_FOUND) {
				// Ignore this and move on
				pushError("file not found in your backup")
				startDownload()
			} else if (_conn)
				_conn.close()
		})
}

// Second step: download the file
// token is a Token object
// size in the actual download size (in bytes)
// uploadId is a string and will name the temp file
// originalHash is a Buffer that will be send for decrypt
function download(token, size, uploadId, originalHash) {
	var conn = net.connect({port: _config.downloadPort, host: _config.host})
	var stream = fs.createWriteStream(_config.tempFolder+uploadId)
	// Let stream creating errors throw
	conn.once("connect", function () {
		conn.write(token.buffer)
		conn.pipe(stream)
	})
	conn.once("error", function () {})
	stream.once("finish", function () {
		if (conn.bytesRead != size) {
			// Give up for now
			if (_conn) _conn.close()
			return
		}
		decrypt(token, size, uploadId, originalHash)
	})
}

// Third step: decrypt and integrity check
// token and size will be send to download if a retry is needed
// uploadId is the temp file name
// originalHash is the SHA1 hash of the original, decrypted file
function decrypt(token, size, uploadId, originalHash) {
	var retry = function () {
		return download(token, size, uploadId, originalHash)
	}
	
	var ENCRYPTED_CHUNK_SIZE = 16+1024*1024+16 // iv+chunk+padding
	var buffer = new Buffer(ENCRYPTED_CHUNK_SIZE)
	var stream = fs.createWriteStream(_config.tempFolder+uploadId+"_final")
	
	// Async decrypt-each-chunk loop
	var aux = function (fd) {
		fs.read(fd, buffer, 0, ENCRYPTED_CHUNK_SIZE, null, function (err, bytesRead) {
			if (err) {
				fs.close(fd, throwErr)
				return retry()
			}
			
			// Decrypt
			var decipher = crypto.createDecipheriv("aes128", _config.aesKey, buffer.slice(0, 16))
			decipher.end(buffer.slice(16, bytesRead))
			stream.write(decipher.read())
			
			if (bytesRead != ENCRYPTED_CHUNK_SIZE) {
				// Wait to write to disk and check
				stream.end(check)
				fs.close(fd, throwErr)
			} else
				// Loop
				return aux(fd)
		})
	}
	
	// Check the final hash against the original
	var check = function () {
		var hash = crypto.createHash("sha1")
		fs.createReadStream(_config.tempFolder+uploadId+"_final").pipe(hash)
		hash.once("readable", function () {
			hash = hash.read()
			if (hash.toString("hex") == originalHash.toString("hex")) {
				// Almost done
				move(uploadId)
			} else if (!_hashFailed) {
				// May be an error with the download, try again
				_hashFailed = true
				retry(uploadId)
			} else {
				// The key (or worst, the uploaded data) is wrong
				pushError("could not decrypt, check your key")
			}
		})
	}
	
	// Open the temp file
	fs.open(_config.tempFolder+uploadId, "r", function (err, fd) {
		if (err) return retry()
		aux(fd)
	})
}

// Last step: move to final position
// uploadId is the temp file name
function move(uploadId) {
	// Remove the encrypted file
	fs.unlink(_config.tempFolder+uploadId, function () {})
	
	// Rename the decrypted file
	fs.rename(_config.tempFolder+uploadId+"_final", _file.fileName, function (err) {
		if (err) return pushError("could not move to final position")
		console.log("[Downloader]", _file.fileName, "done!")
		
		// Remove from the task list
		_file.folder.removeItem(_file.fileName)
		saveData()
		
		// Next cicle
		startDownload()
	})
}

// Add a new error into the current task error list
// Also ignore this file
function pushError(error) {
	_task.errors.push("["+_file.fullPath+"] "+error)
	_file.folder.removeItem(_file.fileName)
	console.error("["+_file.fullPath+"] "+error)
	// TODO: send error to web ui
	saveData()
}

// Persist global states into the disk
function saveData() {
	var data = {format: 1, tasks: _tasks}
	try {
		fs.writeFileSync(_config.dumpFile, JSON.stringify(data))
	} catch (e) {
		console.log("[Downloader] Error while trying to save data into "+_config.dumpFile)
	}
}
