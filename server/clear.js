// Clear old upload sessions and files

"use strict"

var config = require("./config.js")
var MongoClient = require("mongodb").MongoClient
var fs = require("fs")
var path = require("path")

function throwError(err) {
	if (err)
		throw err
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
			
			var n = 0
			oldUploads.forEach(function (uploads) {
				// Process for each user
				var files = uploads.files
				var userName = uploads._id
				db.collection("uploads").remove({user: userName, localName: {$in: files}}, throwError)
				
				// Remove from the disk
				db.collection("users").findOne({name: userName}, function (err, user) {
					throwError(err)
					var userLocalName = user.localName
					files.forEach(function (file) {
						console.log("Removing", config.dataFolder+userLocalName+path.sep+file)
						fs.unlink(config.dataFolder+userLocalName+path.sep+file, function () {})
					})
					
					n++
					if (n == oldUploads.length)
						db.close()
				})
			})
			if (!oldUploads.length)
				db.close()
		})
	})
	
	// Old files in the temp folder
	clearFolder(config.tempFolder, maxTimestamp)
}

function clearFolder(folder, maxTimestamp) {
	// Read all items
	fs.readdir(folder, function (err, files) {
		throwError(err)
		files.forEach(function (file) {
			// Search for files that hasn't been modified recently
			fs.stat(folder+file, function (err, stat) {
				throwError(err)
				if (stat.isFile() && stat.mtime.getTime() < maxTimestamp)
					fs.unlink(folder+file, throwError)
			})
		})
	})
}
