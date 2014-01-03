// Create a new user in the database
// usage: node createUser.js <userName> <password>

"use strict"

var MongoClient = require("mongodb").MongoClient
var config = require("./config.js")
var fs = require("fs")
var crypto = require("crypto")

var userName = process.argv[2]
var password = process.argv[3]

// Check the arguments
if (!userName || !password)
	throw new Error("Please provide your userName and password as arguments")
if (!password.match(/^[0-9a-f]{32}$/i))
	throw new Error("Invalid password, please generate one with generateKeys.js on the client")

// Hash the password
password = new Buffer(password, "hex")
var sha1 = crypto.createHash("sha1")
sha1.write("sitegui-backuper")
sha1.end(password)
password = sha1.read()

// Update the database
MongoClient.connect(config.mongoURL, function (err, db) {
	var localName = getRandomHexString()
	
	if (err)
		throw err
	
	var data = {
		name: userName,
		password: password,
		localName: localName,
		quota: 50*1024*1024*1024 // 50 GiB
	}
	db.collection("users").update({name: userName}, data, {upsert: true}, function (err) {
		if (err)
			throw err
		db.close()
		
		// Create the folder
		fs.mkdirSync(config.dataFolder+localName)
		console.log("User created")
	})
})

// Return a random 16-byte key encoded in hex
function getRandomHexString() {
	var i, str = "", chars = "0123456789abcdef"
	for (i=0; i<32; i++)
		str += chars[Math.floor(Math.random()*16)]
	return str
}
