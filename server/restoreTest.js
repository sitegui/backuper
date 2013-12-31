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

var uploadId = "d7116c816a9abe0a2ba321600d751217"
var userId = "a0f804952b7576b1f7dc31e3474642dc"

var ENCRYPTED_CHUNK_SIZE = 16+1024*1024+16 // iv (16B) + chunk (1MiB) + padding (16B)

MongoClient.connect(config.mongoURL, function (err, db) {
	if (err) throw err
	
	db.collection("files").findOne({localName: uploadId}, function (err, file) {
		if (err) throw err
		if (file)
			decodeFile(config.dataFolder+userId+path.sep+uploadId, decodeFileName(file.path.buffer), file.originalHash.buffer)
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

function decodeFile(fileName, realName, originalHash) {
	var buffer = new Buffer(ENCRYPTED_CHUNK_SIZE), read, source, destination
	
	source = fs.openSync(fileName, "r")
	destination = fs.createWriteStream("restored/"+path.basename(realName))
	
	var n = 0
	while (true) {
		read = fs.readSync(source, buffer, 0, ENCRYPTED_CHUNK_SIZE, null)
		if (!read)
			break
		destination.write(decode(buffer.slice(0, read)))
		console.log("Done chunk", n++)
	}
	destination.end()
	fs.closeSync(source)
	
	destination.on("finish", function () {
		var hash = crypto.createHash("sha1")
		fs.createReadStream("restored/"+path.basename(realName)).pipe(hash)
		hash.on("readable", function () {
			console.log("Original hash", originalHash.toString("hex"))
			console.log("New hash now ", hash.read().toString("hex"))
		})
	})
}
