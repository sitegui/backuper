var aP = require("async-protocol")
var net = require("net")
var config = require("./config.js")
var MongoClient = require("mongodb").MongoClient

var CC_LOGIN = aP.registerClientCall(1, "ss", "u")

var DATA_FALSE = new aP.Data().addUint(0)
var DATA_TRUE = new aP.Data().addUint(1)

// Create the server
net.createServer(function (conn) {
    conn = new aP(conn)
	conn.user = null
    conn.on("call", function (type, data, answer) {
		if (type == CC_LOGIN)
			login(data[0], data[1], answer)
    })
}).listen(config.port)

// DEBUG
MongoClient.connect(config.mongoURL, function (err, db) {
	var collection = db.collection("users")
	collection.findOne({userName: "a", password: "b"}, function (err, result) {
		console.log(err)
		console.log(result)
	})
	collection.insert([{userName: "Guilherme Souza", password: "
})

// Try to login the user
function login(userName, password, answer) {
	MongoClient.connect(config.mongoURL, function (err, db) {
		if (err)
			answer(DATA_FALSE)
		var collection = db.collection("users")
		collection.findOne({userName: userName, password: password}, function (err, result) {
			
		})
	})
}
