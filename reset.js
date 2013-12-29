// Clear all files and database

"use strict"

var fs = require("fs")
var MongoClient = require("mongodb").MongoClient
var config = require("./server/config.js")

// Dumps
try {
	fs.unlinkSync("client/fileWatcher.dump")
	fs.unlinkSync("client/uploader.dump")
} catch (e) {}

// Database
MongoClient.connect(config.mongoURL, function (err, db) {
	if (err) throw err
	
	db.collection("files").drop(function (err) {
		if (err) throw err
		db.collection("uploads").drop(function (err) {
			if (err) throw err
			db.close()
		})
	})
})

// Server files
fs.readdirSync("server/data/temp").forEach(function (file) {
	if (file != "chunks")
		fs.unlinkSync("server/data/temp/"+file)
})
fs.readdirSync("server/data/temp/chunks").forEach(function (file) {
	fs.unlinkSync("server/data/temp/chunks/"+file)
})
fs.readdirSync("server/data").forEach(function (folder) {
	if (folder != "temp")
		fs.readdirSync("server/data/"+folder).forEach(function (file) {
			fs.unlinkSync("server/data/"+folder+"/"+file)
		})
})
