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
var E_CORRUPTED_DATA = aP.registerException(6)

var CC_LOGIN = aP.registerClientCall(1, "st", "", [E_LOGIN_ERROR])
var CC_START_UPLOAD = aP.registerClientCall(2, "(B)uu", "s", [E_NOT_LOGGED_IN, E_OUT_OF_SPACE])
var CC_START_CHUNK_UPLOAD = aP.registerClientCall(3, "sB", "t", [E_NOT_LOGGED_IN, E_INVALID_SESSION])
var CC_COMMIT_CHUNK = aP.registerClientCall(4, "t", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_CORRUPTED_DATA])
var CC_CANCEL_UPLOAD = aP.registerClientCall(5, "s", "", [E_NOT_LOGGED_IN])
var CC_COMMIT_UPLOAD = aP.registerClientCall(6, "s", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_WRONG_SIZE])
var CC_REMOVE_FILE = aP.registerClientCall(7, "(B)", "", [E_NOT_LOGGED_IN])

// Create the server
net.createServer(function (conn) {
	conn = new aP(conn)
	conn.user = null
	conn.on("call", function (type, data, answer) {
		if (type == CC_LOGIN)
			login(data[0], data[1], answer, conn)
		else if (type == CC_START_UPLOAD)
			startUpload(data[0], data[1], data[2], answer)
		else if (type == CC_START_CHUNK_UPLOAD)
			startChunkUpload(data[0], data[1], answer)
		else
			answer()
	})
}).listen(config.port)

// Create the server for the upload port
net.createServer(function (conn) {
	console.log("new upload connection")
	conn.pipe(fs.createWriteStream("data/"+getRandomHexString()))
	conn.once("error", function () {})
	conn.once("close", function () {
		console.log(conn.bytesRead)
	})
}).listen(config.uploadPort)

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

function startUpload(filePath, mtime, size, answer) {
	answer(getRandomHexString())
}

function startChunkUpload(uploadId, hash, answer) {
	answer(new aP.Data().addToken(new aP.Token))
}

// Return the (Buffer) sha1 salted hash of the given (aP.Token) password
function hashPassword(pass) {
	var hash = crypto.createHash("sha1")
	hash.write("sitegui-backuper")
	hash.end(pass.buffer)
	return hash.read()
}

// Return a random 16-byte key encoded in hex
function getRandomHexString() {
	var i, str = "", chars = "0123456789abcdef"
	for (i=0; i<32; i++)
		str += chars[Math.floor(Math.random()*16)]
	return str
}
