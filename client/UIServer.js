"use strict"

// Manage the server for the web interface

var config = require("./config.js").ui
var connect = require("connect")

// Start the server
// FileWatcher and Uploader should be the other two loaded modules
exports.init = function (FileWatcher, Uploader) {
	connect()
	.use(connect.static("ui"))
	.use("/status/fileWatcher", function (req, res) {
		res.end(JSON.stringify(FileWatcher.getStatus()))
	})
	.use("/status/uploader", function (req, res) {
		res.end(JSON.stringify(Uploader.getStatus()))
	})
	.listen(config.port)
}
