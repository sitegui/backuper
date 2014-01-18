// Clear all files and database

"use strict"

var fs = require("fs")
var MongoClient = require("mongodb").MongoClient
var config = require("./config.js")
var path = require("path")

var all = process.argv[2]=="all"

function unlink(file) {
	try {
		fs.unlinkSync(file)
	} catch (e) {}
}

// Database
MongoClient.connect(config.mongoURL, function (err, db) {
	var n = 0
	var check = function () {
		n++
		if (n == collections.length)
			db.close()
	}
	
	if (err) return
	
	var collections = ["files", "uploads"]
	if (all)
		collections.push("users")
	collections.forEach(function (each) {
		db.collection(each).drop(check)
	})
})

// Server files
fs.readdirSync(config.tempFolder).forEach(function (file) {
	unlink(config.tempFolder+file)
})
fs.readdirSync(config.dataFolder).forEach(function (folder) {
	if (folder.match(/^[0-9a-z]{32}$/)) {
		fs.readdirSync(config.dataFolder+folder).forEach(function (file) {
			unlink(config.dataFolder+folder+path.sep+file)
		})
		if (all)
			fs.rmdirSync(config.dataFolder+folder)
	}
})
