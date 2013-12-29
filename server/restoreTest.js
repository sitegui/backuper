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

var uploadId = "081307777838dd20bfc1be91327ffddf"
var myFolder = "data\\f28d94ed23b2e946e3c6a349c5143151\\"

MongoClient.connect(config.mongoURL, function (err, db) {
	if (err) throw err
	
	db.collection("files").findOne({localName: myFolder+uploadId}, function (err, file) {
		if (err) throw err
		if (file)
			decodeFile(file.localName, file.path.map(function (each) {
				return decode(each.buffer).toString()
			}).join(path.sep))
		else
			console.log("File not found")
		db.close()
	})
})

function encode(buffer) {
	var encoder = crypto.createCipheriv("aes128", aesKey, aesIV)
	encoder.end(buffer)
	return encoder.read()
}

function decode(buffer) {
	var decoder = crypto.createDecipheriv("aes128", aesKey, aesIV)
	decoder.end(buffer)
	return decoder.read()
}

function decodeFile(fileName, realName) {
	var buffer = new Buffer(1024*1024+16), read, source, destination
	
	source = fs.openSync(fileName, "r")
	destination = fs.createWriteStream("restored/"+path.basename(realName))
	
	while (true) {
		read = fs.readSync(source, buffer, 0, 1024*1024+16, null)
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
