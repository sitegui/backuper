// Test if a file can be restored

"use strict"

var fs = require("fs")
var crypto = require("crypto")
var path = require("path")
var MongoClient = require("mongodb").MongoClient
var config = require("./config.js")

var keys = fs.readFileSync("../client/keys")
var aesKey = keys.slice(16, 32)
var aesIV = keys.slice(32, 48)

var uploadId = "a744cd0aeb154d9b2c8810146574338b"
var myFolder = "data\\f28d94ed23b2e946e3c6a349c5143151\\"

var ENCRYPTED_CHUNK_SIZE = 16+1024*1024+16 // iv (16B) + chunk (1MiB) + padding (16B)

MongoClient.connect(config.mongoURL, function (err, db) {
	if (err) throw err
	
	db.collection("files").findOne({localName: myFolder+uploadId}, function (err, file) {
		if (err) throw err
		if (file)
			decodeFile(file.localName, decodeFileName(file.path.buffer))
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

function decodeFileName(buffer) {
	var decoder = crypto.createDecipheriv("aes128", aesKey, aesIV)
	decoder.end(buffer)
	return decoder.read().toString()
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
