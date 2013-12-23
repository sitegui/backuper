"use strict"

// Control all the upload activity

var Uploader = new (require("events").EventEmitter)
module.exports = Uploader

var fs = require("fs")
var net = require("net")
var aP = require("async-protocol")

// Start the upload
// config is an object with the keys "dumpFile", "host", "port", "userName", "password", "reconnectionTime"
Uploader.start = function (config) {
	_config = config
	fs.readFile(_config.dumpFile, {encoding: "utf8"}, function (err, data) {
        if (_started)
            throw new Error("Uploader has already been started")
		if (err) {
			// Create a new dump file
			console.log("[Uploader] creating dump file: "+_config.dumpFile)
			
		} else {
			// Get the saved data
			data = JSON.parse(data)
			if (data.format != 1)
                throw new Error("Invalid format")
			
		}
		_started = true
		Uploader.emit("start")
		setInterval(reconnect, _config.reconnectionTime)
	})
}

Uploader.queueFile = function (file) {
    if (!_started)
        throw new Error("Uploader hasn't started")
	
}

/*
Internals
*/

var _config
var _started = false
var _connected = false
var _conn // the async-protocol connection

// Try to connect with the backuper server
function reconnect() {
	if (_connected)
		return
	var conn = net.connect(_config.port)
	conn.on("error", function () {
		// Just ignore
	})
	conn.on("connect", function () {
		_connected = true
		_conn = new aP(conn, true)
		login()
	})
	conn.on("close", function () {
		_connected = false
		_conn = null
	})
}

// Try to login
function login() {
	
}
