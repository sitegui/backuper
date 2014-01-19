// Clear old upload sessions and files

"use strict"

var config = require("./config.js")
var MongoClient = require("mongodb").MongoClient
var fs = require("fs")
var path = require("path")

function throwError(err) {
	if (err) {
		console.trace()
		throw err
	}
}

module.exports = function () {
	console.log("[clear]")
	var maxTimestamp = Date.now()-config.maxAge
	
	// Old sessions in the DB
	MongoClient.connect(config.mongoURL, function (err, db) {
		throwError(err)
		
		// Group by user
		var query = [
			{$match: {timestamp: {$lt: maxTimestamp}}},
			{$group: {_id: "$user", files: {$push: "$localName"}}}
		]
		db.collection("uploads").aggregate(query, function (err, oldUploads) {
			throwError(err)
			
			var counter = new Counter(2*oldUploads.length, function () {
				db.close()
			})
			oldUploads.forEach(function (uploads) {
				// Process for each user
				var files = uploads.files
				var userName = uploads._id
				var query = {user: userName, localName: {$in: files}}
				db.collection("uploads").remove(query, function (err) {
					throwError(err)
					counter.tick()
				})
				
				// Remove from the disk
				db.collection("users").findOne({name: userName}, function (err, user) {
					throwError(err)
					var userLocalName = user.localName
					files.forEach(function (file) {
						console.log("Removing", config.dataFolder+userLocalName+path.sep+file)
						fs.unlink(config.dataFolder+userLocalName+path.sep+file, function () {})
					})
					counter.tick()
				})
			})
		})
	})
	
	// Old files in the temp folder
	fs.readdir(config.tempFolder, function (err, files) {
		throwError(err)
		files.forEach(function (file) {
			// Search for files that hasn't been modified recently
			fs.stat(config.tempFolder+file, function (err, stat) {
				throwError(err)
				if (stat.isFile() && stat.mtime.getTime() < maxTimestamp)
					fs.unlink(config.tempFolder+file, throwError)
			})
		})
	})
}

// Create a new counter
// callback will be executed after the n-th call to counter.tick()
function Counter(num, callback) {
	if (num) {
		this.num = num
		this.callback = callback
		this.i = 0
	} else
		process.nextTick(callback)
}

// Next tick (don't call this more than "num" times)
Counter.prototype.tick = function () {
	this.i++
	if (this.i === this.num)
		process.nextTick(this.callback)
}
