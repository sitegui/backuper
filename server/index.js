"use strict"

var aP = require("async-protocol")
var net = require("net")
var config = require("./config.js")
var MongoClient = require("mongodb").MongoClient
var fs = require("fs")
var crypto = require("crypto")

// Async-protocol definitions
var E_NOT_LOGGED_IN = aP.registerException(1)
var E_OUT_OF_SPACE = aP.registerException(2)
var E_INVALID_SESSION = aP.registerException(3)
var E_LOGIN_ERROR = aP.registerException(4)
var E_WRONG_SIZE = aP.registerException(5)

var CC_LOGIN = aP.registerClientCall(1, "st", "", [E_LOGIN_ERROR])
var CC_START_UPLOAD = aP.registerClientCall(2, "(B)uu", "t", [E_NOT_LOGGED_IN, E_OUT_OF_SPACE])
var CC_START_CHUNK_UPLOAD = aP.registerClientCall(3, "tB", "t", [E_NOT_LOGGED_IN, E_INVALID_SESSION])
var CC_COMMIT_CHUNK = aP.registerClientCall(4, "t", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION])
var CC_CANCEL_UPLOAD = aP.registerClientCall(5, "t", "", [E_NOT_LOGGED_IN])
var CC_COMMIT_UPLOAD = aP.registerClientCall(6, "t", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_WRONG_SIZE])

// Create the server
net.createServer(function (conn) {
	conn = new aP(conn)
	conn.user = null
	conn.on("call", function (type, data, answer) {
		if (type == CC_LOGIN)
			login(data[0], data[1], answer, conn)
	})
}).listen(config.port)

// Create the db connection
var _db = null
MongoClient.connect(config.mongoURL, function (err, db) {
	if (err)
		throw err
	_db = db
	
	// Set-up the database
	db.collection("users").ensureIndex({userName: 1}, {unique: true}, function (err) {
		if (err) throw err
	})
})

// Try to login the user
function login(userName, password, answer, conn) {
	_db.collection("users").findOne({userName: userName, password: hashPassword(password)}, function (err, doc) {
		if (err || !doc)
			answer(new aP.Exception(E_LOGIN_ERROR))
		else {
			answer()
			conn.user = userName
		}
	})
}

// Return the (Buffer) sha1 salted hash of the given (aP.Token) password
function hashPassword(pass) {
	var hash = crypto.createHash("sha1")
	hash.write("sitegui-backuper")
	hash.end(pass.buffer)
	return hash.read()
}
