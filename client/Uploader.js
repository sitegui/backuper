"use strict"

// Control all the upload activity

var Uploader = new (require("events").EventEmitter)
module.exports = Uploader

var fs = require("fs")
var net = require("net")
var aP = require("async-protocol")

var CC_LOGIN = aP.registerClientCall(1, "st", "u")
var CC_CREATE_UPLOAD_SESSION = aP.registerClientCall(2, "", "s")

// Start the upload
// config is an object with the keys "dumpFile", "host", "port", "userName", "reconnectionTime", "loginKey", "aesKey", "aesIV"
Uploader.start = function (config) {
	_config = config
	fs.readFile(_config.dumpFile, {encoding: "utf8"}, function (err, data) {
		if (_started)
			throw new Error("Uploader has already been started")
		if (err) {
			// Create a new dump file
			console.log("[Uploader] creating dump file: "+_config.dumpFile)
			_files = []
			_uploading = null
			saveData()
		} else {
			// Get the saved data
			data = JSON.parse(data)
			if (data.format != 1)
				throw new Error("Invalid format")
			_files = data.files
			_uploading = data.uploading
		}
		_started = true
		Uploader.emit("start")
		reconnect()
		setInterval(reconnect, _config.reconnectionTime)
	})
}

Uploader.queueFile = function (file) {
	if (!_started)
		throw new Error("Uploader hasn't started")
	// TODO: stop upload if affecting the same file
	if (_files.indexOf(file) == -1) {
		_files.push(file)
		saveData()
	}
}

/*
Internals
*/

var _config
var _started = false
var _conn // the async-protocol connection, checked _conn.loggedIn to see if the login was sucessful
var _files // files queued to upload
var _uploading // null if idle, an object with keys "id", "file", "mtime", "size" otherwise

// Try to connect with the backuper server
// Ignore if already connected and logged in
function reconnect() {
	if (_conn && _conn.loggedIn)
		// Already connected
		return
	if (!_uploading && !_files.length)
		// There is no work to do
		return
	var conn = net.connect({port: _config.port, host: _config.host})
	conn.on("error", function () {
		// Just ignore
	})
	conn.on("connect", function () {
		_conn = new aP(conn, true)
		_conn.loggedIn = false
		login()
	})
	conn.on("close", function () {
		_conn = null
	})
}

// Try to login
// In case of sucess, start the uploading sequence
function login() {
	var data = new aP.Data().addString(_config.userName).addToken(_config.loginKey)
	_conn.sendCall(CC_LOGIN, data, function (sucess) {
		_conn.loggedIn = sucess
		if (sucess) stepUploadSequence()
		else console.log("[Uploader] login failed")
	})
}

// Do a single step in the upload process
function stepUploadSequence() {
	var file
	if (!_uploading)
		pickFileToUpload()
	else if (!_uploading.id)
		createUploadSession()
}

// First step in the upload process
// Extract a file from the queue
function pickFileToUpload() {
	if (!_files.length) {
		// No more files to play with, just close the connection
		_conn.close()
		return
	}
	
	// Get all data from the last file
	// Don't extract it right away, wait for the stat response
	file = _files[_files.length-1]
	fs.stat(file, function (err, stats) {
		if (!err) {
			_uploading = {}
			_uploading.id = null
			_uploading.file = file
			_uploading.size = stats.size
			_uploading.mtime = hashDate(stats.mtime)
		}
		_files.pop()
		saveData()
		stepUploadSequence()
	})
}

// Second step in the upload process
// Create a upload session in the server
function createUploadSession() {
	
}

// Save the current data into the disk
// Delay the command in 100ms to avoid acessing to much the disk
var saveData = (function () {
	var interval = null
	
	var doSave = function () {
		var data = {}
		data.format = 1
		data.files = _files
		data.uploading = _uploading
		try {
			fs.writeFileSync(_config.dumpFile, JSON.stringify(data))
		} catch (e) {
			console.error("[Uploader] Error while trying to save data into "+_config.dumpFile)
		}
		interval = null
		console.log("[Uploader] Saved")
	}
	
	return function () {
		console.log("[Uploader] Going to save")
		if (interval)
			clearTimeout(interval)
		interval = setTimeout(doSave, 100)
	}
})()

// Convert a date to a number (based on UTC time)
function hashDate(date) {
	var d, m, y, h, i, s
	d = date.getUTCDate()
	m = date.getUTCMonth()
	y = date.getUTCFullYear()
	h = date.getUTCHours()
	i = date.getUTCMinutes()
	s = date.getUTCSeconds()
	return s+60*(i+60*(h+24*(d+31*(m+12*y))))
}
