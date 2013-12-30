"use strict";

var FileWatcher = require("./FileWatcher.js")
var Uploader = require("./Uploader.js")
var config = require("./config.js")
var fs = require("fs")
var aP = require("async-protocol")
var ui = require("./UIServer.js")

// Load the keys
try {
	var keys = fs.readFileSync("keys")
	config.uploader.loginKey = new aP.Token(keys.slice(0, 16))
	config.uploader.aesKey = keys.slice(16, 32)
	config.uploader.aesIV = keys.slice(32, 48)
} catch (e) {
	throw new Error("Keys not found. Execute generateKeys.js first")
}

// Set-up uploader
Uploader.start(config.uploader)
Uploader.on("start", function () {
	// Set-up the filewatcher
	FileWatcher.start(config.fileWatcher)
	FileWatcher.on("start", function () {
		if (FileWatcher.getFolders().length == 0) {
			FileWatcher.addFolder("C:\\Users\\Guilherme")
			FileWatcher.addFolder("C:\\Program Files (x86)\\Zend\\Apache2\\htdocs")
		}
	})
	
	// Plug the fileWatcher and uploader together
	FileWatcher.on("filechange", function (file) {
		Uploader.queueFileUpdate(file)
	})
	FileWatcher.on("fileremove", function (file) {
		Uploader.queueFileRemove(file)
	})
})

// Set-up the user interface server
ui.init(FileWatcher, Uploader)
