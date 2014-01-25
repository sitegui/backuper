"use strict"

var config = require("./config.js").connect
var aP = require("async-protocol")
var net = require("net")
var fs = require("fs")
var Updater = require("./Updater.js")

aP.setMaxBufferLength(100*1024*1024) // 100 MiB

var cntxt = new aP

cntxt.registerException("#1 notLoggedIn")
cntxt.registerException("#2 outOfSpace")
cntxt.registerException("#3 invalidSession")
cntxt.registerException("#4 loginError")
cntxt.registerException("#5 wrongSize")
cntxt.registerException("#6 corruptedData")
cntxt.registerException("#7 notFound")

cntxt.registerClientCall("#1 login(userName: string, password: token)")
cntxt.registerClientCall("#2 startUpload(filePath: Buffer, mtime: int, size: uint, originalHash: Buffer) -> uploadId: string")
cntxt.registerClientCall("#3 uploadChunk(uploadId: string, hash: Buffer, chunk: Buffer)")
cntxt.registerClientCall("#5 cancelUpload(id: string)")
cntxt.registerClientCall("#6 commitUpload(id: string)")
cntxt.registerClientCall("#7 removeFile(filePath: Buffer)")
cntxt.registerClientCall("#8 getFilesInfo -> files[]: (path: Buffer, versions[]: (size: uint, mtime: int, id: string))")
cntxt.registerClientCall("#9 getQuotaUsage -> total: uint, free: uint, softUse: uint")
cntxt.registerClientCall("#10 requestFileDownload(uploadId: string) -> downloadToken: token, size: uint, originalHash: Buffer")
cntxt.registerClientCall("#11 getCurrentVersion -> version: string")

// Get current version
var _version = JSON.parse(fs.readFileSync("package.json", {encoding: "utf8"})).version

// Try to connect with the backuper server
// callback(conn) isn't optional and will be called after the login
// If something went wrong, conn will be null
module.exports = function (callback) {
	if (Updater.isUpdating())
		// Can't talk to the server until update is done
		return callback(null)
	
	var conn = net.connect({port: config.port, host: config.host})
	conn.once("error", function () {
		callback(null)
	})
	conn.once("connect", function () {
		conn.removeAllListeners()
		conn = cntxt.wrapSocket(conn)
		// Check for updates
		conn.call("getCurrentVersion", null, function (err, result) {
			if (err || result.version != _version) {
				callback(null)
				conn.close()
				if (!err)
					Updater.setNeedUpdate(result.version)
			} else
				doLogin(conn, callback)
		})
	})
}

// Login, given an open connection
function doLogin(conn, callback) {
	conn.call("login", {userName: config.userName, password: config.loginKey}, function (err) {
		if (err) {
			console.error("[connect] login failed")
			callback(null)
			conn.close()
		} else
			callback(conn)
	})
}
