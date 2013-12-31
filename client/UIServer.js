"use strict"

// Manage the server for the web interface

var config = require("./config.js").ui
var http = require("http")
var path = require("path")
var parseUrl = require("url").parse
var fs = require("fs")
var aP = require("async-protocol")
var net = require("net")

var types = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".png": "image/png",
	".txt": "text/plain"
}

var _watcher, _uploader, _aPServer
var _conns = [] // current ws connections

// Set-up protocol calls
var CC_GET_UPLOADER_STATUS = aP.registerClientCall(100, "", "s")
var CC_GET_WATCHER_STATUS = aP.registerClientCall(101, "", "s")
var SC_UPLOADER_PROGRESS = aP.registerServerCall(100, "s")

// Start the server
// Watcher and Uploader should be the other two loaded modules
exports.init = function (Watcher, Uploader) {
	_watcher = Watcher
	_uploader = Uploader
	
	http.createServer(function (req, res) {
		// Get the target file path
		var filePath = parseUrl(req.url).pathname
		if (filePath[filePath.length-1] == "/")
			filePath += "index.html"
		filePath = path.join("ui", filePath)
		
		// Get the mime type
		var type = path.extname(filePath).toLowerCase()
		type = type in types ? types[type] : "application/octet-stream"
		
		// Try to answer the request
		var stream = fs.createReadStream(filePath)
		stream.once("error", function () {
			res.writeHead(404, {"Content-Type": "text/html; charset=utf-8"})
			res.end("Not Found")
		})
		stream.once("readable", function () {
			res.writeHead(200, {"Content-Type": type+"; charset=utf-8"})
			stream.pipe(res)
		})
	}).listen(config.port)
	
	// Set-up the async-protocol server
	_aPServer = net.createServer(function (conn) {
		conn = new aP(conn)
		conn.on("error", function () {})
		conn.on("call", function (type, data, answer) {
			if (type == CC_GET_UPLOADER_STATUS)
				getUploaderStatus(answer)
			else if (type == CC_GET_WATCHER_STATUS)
				getWatcherStatus(answer)
		})
		
		_conns.push(conn)
		conn.once("close", function () {
			var pos = _conns.indexOf(conn)
			if (pos != -1)
				_conns.splice(pos, 1)
		})
	})
	_aPServer.listen(0)
	
	// Set-up the webSocket gate
	aP.createGate(function () {
		return net.connect(_aPServer.address().port)
	}).listen(config.wsPort)
	
	// Expose the used port to JS
	fs.writeFile("ui/port.js", "var _port = "+config.wsPort, function (err) {
		if (err) throw err
	})
	
	// Set the listener for Uploader activity
	_uploader.on("update", function () {
		if (_conns.length) {
			var status = new aP.Data().addString(JSON.stringify(_uploader.getStatus()))
			_conns.forEach(function (conn) {
				conn.sendCall(SC_UPLOADER_PROGRESS, status)
			})
		}
	})
}

function getUploaderStatus(answer) {
	answer(JSON.stringify(_uploader.getStatus()))
}

function getWatcherStatus(answer) {
	answer(JSON.stringify(_watcher.getStatus()))
}
