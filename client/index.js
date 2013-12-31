"use strict";

var Watcher = require("./Watcher.js")
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
	// Set-up the watcher
	Watcher.start(config.watcher)
	Watcher.on("start", function () {
		if (Watcher.getFolders().length == 0) {
			Watcher.addFolder("C:\\Users\\Guilherme")
			Watcher.addFolder("C:\\Program Files (x86)\\Zend\\Apache2\\htdocs")
		}
	})
	
	// Plug the watcher and uploader together
	Watcher.on("filechange", function (file) {
		Uploader.queueFileUpdate(file)
	})
	Watcher.on("fileremove", function (file) {
		Uploader.queueFileRemove(file)
	})
})

// Set-up the user interface server
ui.init(Watcher, Uploader)
