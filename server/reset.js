// Clear all files and database

"use strict"

var fs = require("fs")
var MongoClient = require("mongodb").MongoClient
var config = require("./config.js")
var path = require("path")

function unlink(file) {
	fs.unlink(file, function () {})
}

// Database
MongoClient.connect(config.mongoURL, function (err, db) {
	var n = 0
	var check = function () {
		n++
		if (n == 2)
			db.close()
	}
	
	if (err)
		return db.close()
	db.collection("files").drop(check)
	db.collection("uploads").drop(check)
	//db.collection("users").drop(check)
})

// Server files
fs.readdirSync(config.tempFolder).forEach(function (file) {
	unlink(config.tempFolder+file)
})
fs.readdirSync(config.tempChunksFolder).forEach(function (file) {
	unlink(config.tempChunksFolder+file)
})
fs.readdirSync(config.dataFolder).forEach(function (folder) {
	if (folder.match(/^[0-9a-z]{32}$/))
		fs.readdirSync(config.dataFolder+folder).forEach(function (file) {
			unlink(config.dataFolder+folder+path.sep+file)
		})
})
