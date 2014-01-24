"use strict"

// Expose config values (the result is cached)

var config = require("./Configer.js")("config.ini")
var fs = require("fs")
var aP = require("async-protocol")

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

config.uploader.host = config.downloader.host = config.connect.host

require("./Configer.js").insureArray(config.watcher, "ignore")

module.exports = config
