"use strict"

// Control restore tasks

var Downloader = new (require("events").EventEmitter)
module.exports = Downloader

var net = require("net")
var path = require("path")
var fs = require("fs")
var Tree = require("./Tree.js")
var connect = require("./connect.js")
var crypto = require("crypto")

// Start the restore
// It'll awake from the saved state (or start from scratch if it doesn't exist)
// config is an object with the keys "dumpFile", "downloadPort", "reconnectionTime", "aesKey"
// taskUpdate(taskId, numFiles) is emited when the number of files in the queue changes
// taskError(taskId, errorStr) is emited when any file fails to be recovered
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
		saveData()
		_started = true
		reconnect()
		setInterval(reconnect, _config.reconnectionTime)
	})
	
	// Clear temp files
	fs.readdir(_config.tempFolder, function (err, files) {
		throwErr(err)
		files.forEach(function (file) {
			fs.unlink(_config.tempFolder+file, function () {})
		})
	})
}

// Start a task to download the given server tree to the given destination folder in the client
// files is a Tree, where the the files info is the uploadId for each download
// destination is a string
// Return the task {id: string, numFiles: uint}
Downloader.createTask = function (files, destination) {
	var id = getRandomHexString()
	var numFiles = files.getNumFiles()
	_tasks[id] = {id: id, destination: destination, files: files, errors: [], numFiles: numFiles}
	_hasWork = true
	reconnect()
	saveData()
	return {id: id, numFiles: numFiles}
}

// Return the current status of every download task
// Return an Array of objects like {id: string, destination: string, numFiles: uint, errors[]: string}
Downloader.getStatus = function () {
	var taskId, status = []
	for (taskId in _tasks) {
		status.push({
			id: taskId,
			destination: _tasks[taskId].destination,
			numFiles: _tasks[taskId].numFiles,
			errors: _tasks[taskId].errors
		})
	}
	return status
}

// Cancel the task with the given id
Downloader.cancelTask = function (id) {
	delete _tasks[id]
}

/*
Internals
*/

var _config
var _started = false
var _tasks // An object in which values are objects like {id: string, destination: string, files: Tree, numFiles: uint, errors[]: string} indexed by the task id
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
		// No need to continue
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
	var taskId
	
	// Pick a file to download
	_file = null
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
	_hashFailed = false
	download(_file.folder.getFileInfo(_file.fileName))
}

// Second step: download the file
// uploadId is a string and will name the temp file
function download(uploadId) {
	// Get metadata
	if (!_conn)
		return
	_conn.call("requestFileDownload", {uploadId: uploadId}, function (err, result) {
		// downloadToken: token, size: uint, originalHash: Buffer
		if (err) {
			if (err.name === "notFound")
				// Ignore this and move on
				pushError("file not found in your backup")
			else
				this.close()
			return
		}
		
		// Create the aux connection and wait for the file
		var conn = net.connect({port: _config.downloadPort, host: _config.host})
		var stream = fs.createWriteStream(_config.tempFolder+uploadId)
		conn.once("connect", function () {
			conn.write(result.downloadToken._buffer)
			conn.pipe(stream)
		})
		conn.once("error", function () {})
		stream.once("finish", function () {
			if (conn.bytesRead != result.size) {
				// Give up for now
				if (_conn) _conn.close()
				return
			}
			decrypt(uploadId, result.originalHash)
		})
	})
}

// Third step: decrypt and integrity check
// uploadId is the temp file name
// originalHash is the SHA1 hash of the original, decrypted file
function decrypt(uploadId, originalHash) {
	var ENCRYPTED_CHUNK_SIZE = 16+1024*1024+16 // iv+chunk+padding
	var buffer = new Buffer(ENCRYPTED_CHUNK_SIZE)
	var hash = crypto.createHash("sha1")
	
	// Open the final file
	var stream = createFinalStream()
	stream.once("open", function () {
		// Open the temp file
		fs.open(_config.tempFolder+uploadId, "r", function (err, fd) {
			if (err) return download(uploadId)
			aux(fd)
		})
	})
	stream.once("error", function () {
		pushError("could not save file to final location")
	})
	
	// Async decrypt-each-chunk loop
	var aux = function (fd) {
		fs.read(fd, buffer, 0, ENCRYPTED_CHUNK_SIZE, null, function (err, bytesRead) {
			if (err) {
				fs.close(fd, throwErr)
				return download(uploadId)
			}
			
			// Decrypt
			var decipher = crypto.createDecipheriv("aes128", _config.aesKey, buffer.slice(0, 16))
			try {
				decipher.end(buffer.slice(16, bytesRead))
			} catch (e) {
				fs.close(fd, throwErr)
				if (!_hashFailed) {
					// May be an error with the download, try again
					_hashFailed = true
					return download(uploadId)
				} else {
					// The key (or worst, the uploaded data) is wrong
					return pushError("could not decrypt file, check your key")
				}
			}
			var originalChunk = decipher.read()
			stream.write(originalChunk)
			hash.write(originalChunk)
			
			if (bytesRead != ENCRYPTED_CHUNK_SIZE) {
				// Wait to write to disk and check
				fs.close(fd, throwErr)
				stream.end(check)
			} else
				// Loop
				return aux(fd)
		})
	}
	
	// Check the final hash against the original
	var check = function () {
		hash.end()
		hash = hash.read()
		if (hash.toString("hex") == originalHash.toString("hex")) {
			// Done
			fs.unlink(_config.tempFolder+uploadId, function () {})
			_file.folder.removeItem(_file.fileName)
			_task.numFiles--
			Downloader.emit("taskUpdate", _task.id, _task.numFiles)
			saveData()
			startDownload()
		} else if (!_hashFailed) {
			// May be an error with the download, try again
			_hashFailed = true
			download(uploadId)
		} else {
			// The key (or worst, the uploaded data) is wrong
			pushError("could not decrypt file, check your key")
		}
	}
}

// Return a writable stream to final file
// Watch for "open" and "error" events on the stream
function createFinalStream() {
	var finalPath = path.join(_task.destination, _file.fullPath)
	
	// Create the necessary folders
	var parts = finalPath.split(path.sep)
	var i, str = ""
	for (i=0; i<parts.length-1; i++) {
		str += parts[i]+path.sep
		if (i)
			try {
				fs.mkdirSync(str)
			} catch (e) {
				// Ignore errors for now
			}
	}
	
	return fs.createWriteStream(finalPath, {flags: "wx"})
}

// Add a new error into the current task error list
// Also ignore this file
function pushError(error) {
	error = "["+_file.fullPath+"] "+error
	_task.errors.push(error)
	_file.folder.removeItem(_file.fileName)
	_task.numFiles--
	Downloader.emit("taskError", _task.id, error)
	Downloader.emit("taskUpdate", _task.id, _task.numFiles)
	saveData()
	startDownload()
}

// Persist global states into the disk
function saveData() {
	// Clear the current tree regularly
	if (_task) {
		saveData.counter++
		if (saveData.counter%10 == 0)
			_task.files.clear()
	}
	
	var data = {format: 1, tasks: _tasks}
	try {
		fs.writeFileSync(_config.dumpFile, JSON.stringify(data))
	} catch (e) {
		console.log("[Downloader] Error while trying to save data into "+_config.dumpFile)
	}
}
saveData.counter = 0

// Return a random 16-byte key encoded in hex
function getRandomHexString() {
	var i, str = "", chars = "0123456789abcdef"
	for (i=0; i<32; i++)
		str += chars[Math.floor(Math.random()*16)]
	return str
}
