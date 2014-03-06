"use strict";

var Watcher = require("./Watcher.js")
var Uploader = require("./Uploader.js")
var config = require("./config.js")
var ui = require("./UIServer.js")
var Downloader = require("./Downloader.js")

console.log("[index.js] "+new Date)

// Set-up uploader
Uploader.start(config.uploader)
Uploader.on("start", function () {
	// Set-up the watcher
	Watcher.start(config.watcher)
	
	// Plug the watcher and uploader together
	Watcher.on("filechange", function (file) {
		Uploader.queueFileUpdate(file)
	})
	Watcher.on("fileremove", function (file) {
		Uploader.queueFileRemove(file)
	})
	Uploader.on("ignoreFile", Watcher.forgetFile)
})
Downloader.start(config.downloader)

// Set-up the user interface server
ui.init(Watcher, Uploader, Downloader)
