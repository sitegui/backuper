"use strict"

var aP = require("async-protocol")
var net = require("net")
var config = require("./config.js")
var MongoClient = require("mongodb").MongoClient
var fs = require("fs")
var crypto = require("crypto")
var path = require("path")

// Async-protocol definitions
var cntxt = new aP

cntxt.registerException("#1 notLoggedIn")
cntxt.registerException("#2 outOfSpace")
cntxt.registerException("#3 invalidSession")
cntxt.registerException("#4 loginError")
cntxt.registerException("#5 wrongSize")
cntxt.registerException("#6 corruptedData")
cntxt.registerException("#7 notFound")

var CHUNK_SIZE = 1*1024*1024 // 1 MiB

// Set-up clean logic
var clear = require("./clear.js")
clear()
setInterval(clear, config.maxAge/10)

function throwError(err) {
	if (err) {
		console.trace()
		throw err
	}
}

// Save the tokens given for download operations
// Each key is a hex-encoded token and each value is the file relative path to config.dataFolder
var _downloads = {}

// Create the server
var server = net.createServer().listen(config.port)
cntxt.wrapServer(server)

// Create the server for the download port
net.createServer(function (conn) {
	var buffer = new Buffer(0)
	var onreadable = function () {
		var data = conn.read(), localName, id
		if (!data) return
		
		// Extract the first 16 bytes as the download token
		buffer = Buffer.concat([buffer, data], buffer.length+data.length)
		if (buffer.length == 16) {
			id = new aP.Token(buffer)
			localName = _downloads[id]
			if (!localName)
				return conn.end()
			delete _downloads[id]
			var stream = fs.createReadStream(config.dataFolder+localName)
			stream.pipe(conn)
			conn.removeListener("readable", onreadable)
		}
	}
	conn.on("readable", onreadable)
	conn.once("error", function () {})
}).listen(config.downloadPort)

// Create the db connection
var _db = null
MongoClient.connect(config.mongoURL, function (err, db) {
	throwError(err)
	_db = db
	
	// Set-up the database
	db.collection("users").ensureIndex({name: 1}, {unique: true}, throwError)
	db.collection("files").ensureIndex({user: 1}, throwError)
	db.collection("files").ensureIndex({user: 1}, throwError)
})

// Try to login the user
cntxt.registerClientCall("#1 login(userName: string, password: token)", function (args, answer) {
	var query = {name: args.userName, password: hashPassword(args.password)}
	var that = this
	_db.collection("users").findOne(query, function (err, user) {
		throwError(err)
		if (!user)
			answer(new aP.Exception("loginError"))
		else {
			answer()
			that.user = user
		}
	})
})

cntxt.registerClientCall("#2 startUpload(filePath: Buffer, mtime: int, size: uint, originalHash: Buffer) -> uploadId: string", function (args, answer) {
	var user = this.user
	if (!user)
		return answer(new aP.Exception("notLoggedIn"))
	
	freeSpace(args.size, user, function (sucess) {
		if (!sucess)
			return answer(new aP.Exception("outOfSpace"))
		
		var data = {
			localName: getRandomHexString(),
			user: user.name,
			filePath: args.filePath,
			mtime: args.mtime,
			size: args.size,
			receivedChunks: 0,
			originalHash: args.originalHash,
			timestamp: Date.now()
		}
		_db.collection("uploads").insert(data, function (err) {
			throwError(err)
			
			// Create an empty file
			fs.open(config.tempFolder+data.localName, "wx", function (err, fd) {
				throwError(err)
				fs.close(fd, function (err) {
					throwError(err)
					console.log("[server] upload started with id %s", data.localName)
					answer({uploadId: data.localName})
				})
			})
		})
	})
})

// Try to allocate the amount of space needed
// Delete old files if necessary
// callback(bool sucess) is called at the end
function freeSpace(size, user, callback) {
	var quota = user.quota
	
	// Get the current number of used space
	var query = [
		{$match: {user: user.name}},
		{$group: {_id: null, usedSpace: {$sum: "$size"}}}
	]
	_db.collection("files").aggregate(query, function (err, result) {
		throwError(err)
		var used = result.length ? result[0].usedSpace : 0
		var needToBeFreed = used+size-quota
		var query, fields, sort
		if (needToBeFreed < 0)
			// Ok, there is space for more
			return callback(true)
		
		// Find files to delete (biggest first)
		query = {user: user.name, old: true}
		fields = {size: true, localName: true}
		sort = [["size", -1]]
		_db.collection("files").find(query, fields).sort(sort).toArray(function (err, files) {
			var i, willBeDeleted = []
			throwError(err)
			
			for (i=0; i<files.length; i++) {
				needToBeFreed -= files[i].size
				willBeDeleted.push(files[i].localName)
				if (needToBeFreed < 0)
					break
			}
			
			if (needToBeFreed > 0)
				// It was not enough...
				return callback(false)
			
			// Exclude files from db
			var query = {localName: {$in: willBeDeleted}}
			_db.collection("files").remove(query, throwError)
			
			// Exclude from the disk
			willBeDeleted.forEach(function (file) {
				fs.unlink(config.dataFolder+user.localName+path.sep+file, function () {})
			})
			
			callback(true)
		})
	})
}

cntxt.registerClientCall("#3 uploadChunk(uploadId: string, hash: Buffer, chunk: Buffer)", function (args, answer) {
	var user = this.user
	if (!user)
		return answer(new aP.Exception("notLoggedIn"))
	
	_db.collection("uploads").findOne({localName: args.uploadId, user: user.name}, function (err, upload) {
		throwError(err)
		if (!upload)
			return answer(new aP.Exception("invalidSession"))
		
		// Check the hash
		var hash = crypto.createHash("sha1")
		hash.end(args.chunk)
		if (hash.read().toString("hex") !== args.hash.toString("hex"))
			return answer(new aP.Exception("corruptedData"))
		
		// Check the size
		if (args.chunk.length > 16+CHUNK_SIZE+16)
			return answer(new aP.Exception("corruptedData"))
		
		// Append to the upload session file
		var uploadTempPath = config.tempFolder+upload.localName
		var uploadFinalPath = config.dataFolder+user.localName+path.sep+upload.localName
		var append = function () {
			fs.appendFile(uploadTempPath, args.chunk, function (err) {
				throwError(err)
				
				// Update the number of received chunks in the db
				var query = {user: user.name, localName: upload.localName}
				_db.collection("uploads").update(query, {$inc: {receivedChunks: 1}}, throwError)
				
				console.log("[server] %d/%d %s", upload.receivedChunks+1, Math.ceil(upload.size/CHUNK_SIZE), upload.localName)
				
				// Done
				answer()
			})
		}
		
		if (upload.receivedChunks%100 == 99)
			// First copy the previous chunks to the final location
			appendAndRemove(uploadTempPath, uploadFinalPath, function (err) {
				throwError(err)
				append()
			})
		else
			append()
	})
})

cntxt.registerClientCall("#5 cancelUpload(id: string)", function (args, answer) {
	var user = this.user
	if (!user)
		return answer(new aP.Exception("notLoggedIn"))
	
	_db.collection("uploads").findOne({localName: args.id, user: user.name}, function (err, upload) {
		throwError(err)
		if (upload) {
			// Remove the file
			fs.unlink(config.tempFolder+upload.localName, function () {})
			
			// Remove from the database
			_db.collection("uploads").remove({localName: args.id, user: user.name}, throwError)
			
			// Possibly remove the partial commit from the data folder
			fs.unlink(config.dataFolder+user.localName+path.sep+args.id, function () {})
		}
		answer()
	})
})

cntxt.registerClientCall("#6 commitUpload(id: string)", function (args, answer) {
	var user = this.user
	if (!user)
		return answer(new aP.Exception("notLoggedIn"))
	
	// Check the session in the database
	_db.collection("uploads").findAndRemove({localName: args.id, user: user.name}, [], function (err, upload) {
		throwError(err)
		if (!upload) return answer(new aP.Exception("invalidSession"))
		
		// Check the size
		if (upload.receivedChunks != Math.ceil(upload.size/CHUNK_SIZE))
			return answer(new aP.Exception("wrongSize"))
		
		// Move the file
		var uploadTempPath = config.tempFolder+upload.localName
		var uploadFinalPath = config.dataFolder+user.localName+path.sep+upload.localName
		appendAndRemove(uploadTempPath, uploadFinalPath, function (err) {
			throwError(err)
			answer()
		})
		
		// Save in the database
		var file = {path: upload.filePath, user: user.name}
		_db.collection("files").update(file, {$inc: {version: 1}, $set: {old: true}}, {multi: true}, function (err) {
			throwError(err)
			var file = {
				user: user.name,
				path: upload.filePath,
				size: upload.size,
				mtime: upload.mtime,
				version: 0,
				old: false,
				localName: upload.localName,
				originalHash: upload.originalHash
			}
			_db.collection("files").insert(file, throwError)
			console.log("[server] upload %s completed", upload.localName)
		})
	})
})

cntxt.registerClientCall("#7 removeFile(filePath: Buffer)", function (args, answer) {
	var user = this.user
	if (!user)
		return answer(new aP.Exception("notLoggedIn"))
	
	_db.collection("files").update({path: args.filePath, user: user.name, old: false}, {$set: {old: true}}, function (err) {
		throwError(err)
		answer()
	})
})

cntxt.registerClientCall("#8 getFilesInfo -> files[]: (path: Buffer, versions[]: (size: uint, mtime: int, id: string))", function (args, answer) {
	var user = this.user
	if (!user)
		return answer(new aP.Exception("notLoggedIn"))
	
	var query = {user: user.name}
	var fields = {size: "$size", mtime: "$mtime", id: "$localName"}
	_db.collection("files").aggregate([
		{$match: query},
		{$sort: {version: 1}},
		{$group: {_id: "$path", versions: {$push: fields}}}
	], function (err, files) {
		throwError(err)
		files.forEach(function (file) {
			file.path = file._id.buffer
		})
		answer({files: files})
	})
})

cntxt.registerClientCall("#9 getQuotaUsage -> total: uint, free: uint, softUse: uint", function (args, answer) {
	var user = this.user
	if (!user)
		return answer(new aP.Exception("notLoggedIn"))
	
	// Get the total space
	var query = {name: user.name}
	_db.collection("users").findOne(query, function (err, userData) {
		throwError(err)
		var total = userData.quota
		
		// Get used (soft and hard)
		var query = [
			{$match: {user: user.name}},
			{$group: {_id: "$old", totalSize: {$sum: "$size"}}}
		]
		_db.collection("files").aggregate(query, function (err, result) {
			throwError(err)
			
			var soft = 0, hard = 0
			result.forEach(function (each) {
				if (each._id)
					soft = each.totalSize
				else
					hard = each.totalSize
			})
			
			// Ready to return
			var free = Math.max(total-hard-soft, 0)
			answer({total: total, free: free, softUse: soft})
		})
	})
})

cntxt.registerClientCall("#10 requestFileDownload(uploadId: string) -> downloadToken: token, size: uint, originalHash: Buffer", function (args, answer) {
	var user = this.user
	if (!user)
		return answer(new aP.Exception("notLoggedIn"))
	
	var query = {user: user.name, localName: args.uploadId}
	
	// Get file hash
	_db.collection("files").findOne(query, function (err, file) {
		throwError(err)
		if (!file)
			return answer(new aP.Exception("notFound"))
		
		// Get file size
		fs.stat(config.dataFolder+user.localName+path.sep+file.localName, function (err, stat) {
			throwError(err)
			
			var token = new aP.Token
			_downloads[token] = user.localName+path.sep+file.localName
			answer({downloadToken: token, size: stat.size, originalHash: file.originalHash.buffer})
		})
	})
})

// Return the (Buffer) sha1 salted hash of the given (aP.Token) password
function hashPassword(pass) {
	var hash = crypto.createHash("sha1")
	hash.write("sitegui-backuper")
	hash.end(pass._buffer)
	return hash.read()
}

// Return a random 16-byte key encoded in hex
function getRandomHexString() {
	var i, str = "", chars = "0123456789abcdef"
	for (i=0; i<32; i++)
		str += chars[Math.floor(Math.random()*16)]
	return str
}

// Append a file to another (posibly across disks)
// Also remove the source file
function appendAndRemove(oldPath, newPath, callback) {
	var source = fs.createReadStream(oldPath)
	var destination = fs.createWriteStream(newPath, {flags: "a"})
	var fine = true
	source.pipe(destination)
	source.on("error", function (err) {
		fine = false
		callback(err)
	})
	destination.once("finish", function () {
		if (fine)
			fs.unlink(oldPath, callback)
	})
}
