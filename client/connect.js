"use strict"

var config = require("./config.js").connect
var aP = require("async-protocol")
var net = require("net")

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
cntxt.registerClientCall("#3 startChunkUpload(uploadId: string, hash: Buffer) -> chunkId: string")
cntxt.registerClientCall("#4 commitChunk(id: string)")
cntxt.registerClientCall("#5 cancelUpload(id: string)")
cntxt.registerClientCall("#6 commitUpload(id: string)")
cntxt.registerClientCall("#7 removeFile(filePath: Buffer)")
cntxt.registerClientCall("#8 getFilesInfo -> files[]: (path: Buffer, versions[]: (size: uint, mtime: int, id: string))")
cntxt.registerClientCall("#9 getQuotaUsage -> total: uint, free: uint, softUse: uint")
cntxt.registerClientCall("#10 requestFileDownload(uploadId: string) -> downloadToken: token, size: uint, originalHash: Buffer")

// Try to connect with the backuper server
// callback(conn) isn't optional and will be called after the login
// If something went wrong, conn will be null
module.exports = function (callback) {
	var conn = net.connect({port: config.port, host: config.host})
	conn.once("error", function () {
		callback(null)
	})
	conn.once("connect", function () {
		conn.removeAllListeners()
		conn = cntxt.wrapSocket(conn)
		conn.call("login", {userName: config.userName, password: config.loginKey}, function (err) {
			if (err) {
				console.error("[connect] login failed")
				callback(null)
				conn.close()
			} else
				callback(conn)
		})
	})
}
