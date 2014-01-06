"use strict";

var Watcher = require("./Watcher.js")
var Uploader = require("./Uploader.js")
var config = require("./config.js")
var fs = require("fs")
var aP = require("async-protocol")
var ui = require("./UIServer.js")
var Downloader = require("./Downloader.js")

// Load the keys
try {
	var keys = fs.readFileSync("keys")
	config.connect.loginKey = new aP.Token(keys.slice(0, 16))
	config.uploader.aesKey = keys.slice(16, 32)
	config.downloader.aesKey = keys.slice(16, 32)
	config.uploader.aesIV = keys.slice(32, 48)
} catch (e) {
	throw new Error("Keys not found. Execute generateKeys.js first")
}

// Set-up uploader
config.uploader.host = config.downloader.host = config.connect.host
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
})
Downloader.start(config.downloader)

// Set-up the user interface server
ui.init(Watcher, Uploader, Downloader)
