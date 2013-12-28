"use strict";

// Control all the upload activity

var Uploader = new (require("events").EventEmitter)
module.exports = Uploader

var fs = require("fs")
var net = require("net")
var path = require("path")
var aP = require("async-protocol")
var Tree = require("./Tree.js")

var UPDATE = 0
var REMOVE = 1

// Async-protocol definitions
var E_NOT_LOGGED_IN = aP.registerException(1)
var E_OUT_OF_SPACE = aP.registerException(2)
var E_INVALID_SESSION = aP.registerException(3)
var E_LOGIN_ERROR = aP.registerException(4)
var E_WRONG_SIZE = aP.registerException(5)

var CC_LOGIN = aP.registerClientCall(1, "st", "", [E_LOGIN_ERROR])
var CC_START_UPLOAD = aP.registerClientCall(2, "(B)uu", "t", [E_NOT_LOGGED_IN, E_OUT_OF_SPACE])
var CC_START_CHUNK_UPLOAD = aP.registerClientCall(3, "tB", "t", [E_NOT_LOGGED_IN, E_INVALID_SESSION])
var CC_COMMIT_CHUNK = aP.registerClientCall(4, "t", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION])
var CC_CANCEL_UPLOAD = aP.registerClientCall(5, "t", "", [E_NOT_LOGGED_IN])
var CC_COMMIT_UPLOAD = aP.registerClientCall(6, "t", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_WRONG_SIZE])

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
		reconnect()
		setInterval(reconnect, _config.reconnectionTime)
	})
}

Uploader.queueFileUpdate = function (file) {
	setFileInfo(file, UPDATE)
}

Uploader.queueFileRemove = function (file) {
	setFileInfo(file, REMOVE)
}

/*
Internals
*/

var _config
var _started = false
var _conn // the async-protocol connection, checked _conn.loggedIn to see if the login was sucessful
var _tree // files queued to update
var _uploading // null if idle, an object with keys "id", "file", "mtime", "size" otherwise

// Aux function for queueFileUpdate and queueFileRemove
function setFileInfo(file, info) {
	var folder, parts
	if (!_started)
		throw new Error("Uploader hasn't started")
	// TODO: stop upload if affecting the same file
	parts = file.split(path.sep)
	file = parts.pop()
	folder = _tree.getFolder(parts.join(path.sep))
	folder.setFileInfo(file, info)
	saveData()
}

// Try to connect with the backuper server
// Ignore if already connected and logged in
function reconnect() {
	if (_conn && _conn.loggedIn)
		// Already connected
		return
	if (!_uploading && _tree.isEmpty())
		// There is no work to do
		return
	var conn = net.connect({port: _config.port, host: _config.host})
	conn.on("error", function () {})
	conn.once("connect", function () {
		_conn = new aP(conn, true)
		_conn.once("close", function () {
			_conn = null
		})
		_conn.loggedIn = false
		login()
	})
}

// Try to login
// In case of sucess, start the uploading sequence
function login() {
	var data = new aP.Data().addString(_config.userName).addToken(_config.loginKey)
	_conn.sendCall(CC_LOGIN, data, function () {
		_conn.loggedIn = true
		stepUploadSequence()
	}, function () {
		console.log("[Uploader] login failed")
		_conn.close()
	})
}

// Do a single step in the upload process
function stepUploadSequence() {
	if (!_uploading)
		pickFileToUpload()
	else if (!_uploading.id)
		createUploadSession()
}

// First step in the upload process
// Extract a file from the queue
function pickFileToUpload() {
	// 
	
	if (_tree.isEmpty()) {
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
		data.tree = _tree
		data.uploading = _uploading
		try {
			fs.writeFileSync(_config.dumpFile, JSON.stringify(data))
		} catch (e) {
			console.error("[Uploader] Error while trying to save data into "+_config.dumpFile)
		}
		interval = null
	}
	
	return function () {
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
