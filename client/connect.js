"use strict"

var config = require("./config.js").connect
var aP = require("async-protocol")
var net = require("net")

var E_LOGIN_ERROR = aP.registerException(4)
var CC_LOGIN = aP.registerClientCall(1, "st", "", [E_LOGIN_ERROR])

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
		conn = new aP(conn, true)
		var data = new aP.Data().addString(config.userName).addToken(config.loginKey)
		conn.sendCall(CC_LOGIN, data, function () {
			callback(conn)
		}, function () {
			console.error("[Uploader] login failed")
			callback(null)
			conn.close()
		})
	})
}
