var aP = require("async-protocol")
var net = require("net")
var config = require("./config.js")
var MongoClient = require("mongodb").MongoClient
var fs = require("fs")
var crypto = require("crypto")

var CC_LOGIN = aP.registerClientCall(1, "st", "u")

var DATA_FALSE = new aP.Data().addUint(0)
var DATA_TRUE = new aP.Data().addUint(1)

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
		if (err || !doc) {
			answer(DATA_FALSE)
			conn.close()
		} else {
			answer(DATA_TRUE)
			conn.user = userName
			console.log(doc._id)
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
