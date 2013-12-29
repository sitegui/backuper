// Test if a file can be restored

"use strict"

var fs = require("fs")
var crypto = require("crypto")
var path = require("path")
var MongoClient = require("mongodb").MongoClient
var config = require("./config.js")

var aesKey = fs.readFileSync("../client/keys").slice(16, 32)

var uploadId = "53fc612812309642e7e5f54ef2cec07a"
var myFolder = "data\\f28d94ed23b2e946e3c6a349c5143151\\"

var ENCRYPTED_CHUNK_SIZE = 16+1024*1024+16 // iv (16B) + chunk (1MiB) + padding (16B)

MongoClient.connect(config.mongoURL, function (err, db) {
	if (err) throw err
	
	db.collection("files").findOne({localName: myFolder+uploadId}, function (err, file) {
		if (err) throw err
		if (file)
			decodeFile(file.localName, decode(file.path.buffer).toString())
		else
			console.log("File not found")
		db.close()
	})
})

function decode(buffer) {
	var iv = buffer.slice(0, 16)
	var decoder = crypto.createDecipheriv("aes128", aesKey, iv)
	decoder.end(buffer.slice(16))
	return decoder.read()
}

function decodeFile(fileName, realName) {
	var buffer = new Buffer(ENCRYPTED_CHUNK_SIZE), read, source, destination
	
	source = fs.openSync(fileName, "r")
	destination = fs.createWriteStream("restored/"+path.basename(realName))
	
	while (true) {
		read = fs.readSync(source, buffer, 0, ENCRYPTED_CHUNK_SIZE, null)
		if (!read)
			break
		destination.write(decode(buffer.slice(0, read)))
	}
	destination.end()
	fs.closeSync(source)
	destination.on("finish", function () {
		hashFile("restored/"+path.basename(realName))
		hashFile(realName)
	})
}

function hashFile(fileName) {
	var hash = crypto.createHash("sha1")
	var stream = fs.createReadStream(fileName)
	stream.pipe(hash)
	stream.on("end", function () {
		console.log(fileName)
		console.log("size=%d, hash=%s", fs.statSync(fileName).size, hash.read().toString("hex"))
	})
}
