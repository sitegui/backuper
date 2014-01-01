"use strict"

var aP = require("async-protocol")
var net = require("net")
var config = require("./config.js")
var MongoClient = require("mongodb").MongoClient
var fs = require("fs")
var crypto = require("crypto")
var path = require("path")

// Async-protocol definitions
var E_NOT_LOGGED_IN = aP.registerException(1)
var E_OUT_OF_SPACE = aP.registerException(2)
var E_INVALID_SESSION = aP.registerException(3)
var E_LOGIN_ERROR = aP.registerException(4)
var E_WRONG_SIZE = aP.registerException(5)
var E_CORRUPTED_DATA = aP.registerException(6)

var CC_LOGIN = aP.registerClientCall(1, "st", "", [E_LOGIN_ERROR])
var CC_START_UPLOAD = aP.registerClientCall(2, "BuuB", "s", [E_NOT_LOGGED_IN, E_OUT_OF_SPACE])
var CC_START_CHUNK_UPLOAD = aP.registerClientCall(3, "sB", "s", [E_NOT_LOGGED_IN, E_INVALID_SESSION])
var CC_COMMIT_CHUNK = aP.registerClientCall(4, "s", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_CORRUPTED_DATA])
var CC_CANCEL_UPLOAD = aP.registerClientCall(5, "s", "", [E_NOT_LOGGED_IN])
var CC_COMMIT_UPLOAD = aP.registerClientCall(6, "s", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_WRONG_SIZE])
var CC_REMOVE_FILE = aP.registerClientCall(7, "B", "", [E_NOT_LOGGED_IN])
var CC_GET_FILES_INFO = aP.registerClientCall(8, "", "(B(uus))", [E_NOT_LOGGED_IN])

var CHUNK_SIZE = 1*1024*1024 // 1 MiB

function throwError(err) {
	if (err)
		throw err
}

// Save the data about the current chunk uploads
// The keys are the session ids (hex-encoded) and the values are objets like {hash: Buffer, upload: <the-bd-upload-doc>}
var _chunks = {}

// Create the server
net.createServer(function (conn) {
	conn = new aP(conn)
	conn.user = null
	conn.on("call", function (type, data, answer) {
		if (type == CC_LOGIN)
			login(data[0], data[1], answer, conn)
		else {
			if (!conn.user)
				answer(new aP.Exception(E_NOT_LOGGED_IN))
			else if (type == CC_START_UPLOAD)
				startUpload(data[0], data[1], data[2], data[3], answer, conn.user)
			else if (type == CC_START_CHUNK_UPLOAD)
				startChunkUpload(data[0], data[1], answer, conn.user)
			else if (type == CC_COMMIT_CHUNK)
				commitChunk(data, answer, conn.user)
			else if (type == CC_CANCEL_UPLOAD)
				cancelUpload(data, answer, conn.user)
			else if (type == CC_COMMIT_UPLOAD)
				commitUpload(data, answer, conn.user)
			else if (type == CC_REMOVE_FILE)
				removeFile(data, answer, conn.user)
			else if (type == CC_GET_FILES_INFO)
				getFilesInfo(answer, conn.user)
		}
	})
}).listen(config.port)

// Create the server for the upload port
net.createServer(function (conn) {
	var buffer = new Buffer(0)
	var stream
	var onreadable = function () {
		var data = conn.read(), id
		if (!data) return
		
		// Extract the first 32 bytes as the chunk id
		buffer = Buffer.concat([buffer, data], buffer.length+data.length)
		if (buffer.length >= 32) {
			id = buffer.slice(0, 32).toString()
			if (!id.match(/^[0-9a-f]{32}$/))
				return conn.close()
			
			// Dump all bytes after the 32º to a temp file
			stream = fs.createWriteStream(config.tempChunksFolder+id)
			stream.write(buffer.slice(32))
			conn.pipe(stream)
		}
		conn.removeListener("readable", onreadable)
	}
	conn.on("readable", onreadable)
	conn.once("error", function () {})
}).listen(config.uploadPort)

// Create the db connection
var _db = null
MongoClient.connect(config.mongoURL, function (err, db) {
	throwError(err)
	_db = db
	
	// Set-up the database
	db.collection("users").ensureIndex({name: 1}, {unique: true}, throwError)
})

// Try to login the user
function login(userName, password, answer, conn) {
	_db.collection("users").findOne({name: userName, password: hashPassword(password)}, function (err, user) {
		throwError(err)
		if (!user)
			answer(new aP.Exception(E_LOGIN_ERROR))
		else {
			console.log("[server] %s logged in", user.name)
			answer()
			conn.user = user
		}
	})
}

function startUpload(filePath, mtime, size, originalHash, answer, user) {
	freeSpace(size, user, function (sucess) {
		if (!sucess)
			return answer(new aP.Exception(E_OUT_OF_SPACE))
		
		var data = {
			localName: getRandomHexString(),
			user: user.name,
			filePath: filePath,
			mtime: mtime,
			size: size,
			receivedChunks: 0,
			originalHash: originalHash,
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
					answer(data.localName)
				})
			})
		})
	})
}

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
		console.log("[needToBeFreed]", needToBeFreed)
		if (needToBeFreed < 0)
			// Ok, there is space for more
			return callback(true)
		
		// Find files to delete (biggest first)
		query = {user: user.name, old: true}
		fields = {size: true, localName: true}
		sort = [["size", -1]]
		_db.collection("files").find(query, fields).sort(sort, function (err, files) {
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
			
			console.log("[willBeDeleted]", willBeDeleted)
			
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

function startChunkUpload(uploadId, hash, answer, user) {
	_db.collection("uploads").findOne({localName: uploadId, user: user.name}, function (err, upload) {
		var chunkId
		throwError(err)
		if (!upload)
			return answer(new aP.Exception(E_INVALID_SESSION))
		chunkId = getRandomHexString()
		_chunks[chunkId] = {hash: hash, upload: upload}
		answer(chunkId)
	})
}

function commitChunk(chunkId, answer, user) {
	// Get chunk info
	var chunk = _chunks[chunkId]
	if (!chunk || chunk.upload.user != user.name)
		return answer(new aP.Exception(E_INVALID_SESSION))
	delete _chunks[chunkId]
	
	// Check the data
	var chunkPath = config.tempChunksFolder+chunkId
	var uploadTempPath = config.tempFolder+chunk.upload.localName
	var uploadFinalPath = config.dataFolder+user.localName+path.sep+chunk.upload.localName
	fs.readFile(chunkPath, function (err, data) {
		throwError(err)
		
		// Check the hash
		var hash = crypto.createHash("sha1")
		hash.end(data)
		hash = hash.read()
		if (hash.toString("hex") != chunk.hash.toString("hex"))
			return answer(new aP.Exception(E_CORRUPTED_DATA))
		
		// Check the size
		if (data.length > 16+CHUNK_SIZE+16)
			return answer(new aP.Exception(E_CORRUPTED_DATA))
		
		// Append to the upload session file
		var append = function () {
			fs.appendFile(uploadTempPath, data, function (err) {
				throwError(err)
				
				// Update the number of received chunks in the db
				var query = {user: user.name, localName: chunk.upload.localName}
				_db.collection("uploads").update(query, {$inc: {receivedChunks: 1}}, throwError)
				
				console.log("[server] %d/%d %s", chunk.upload.receivedChunks+1, Math.ceil(chunk.upload.size/CHUNK_SIZE), chunk.upload.localName)
				
				// Done
				answer()
			})
			fs.unlink(chunkPath, throwError)
		}
		
		if (chunk.upload.receivedChunks%100 == 99)
			// First copy the previous chunks to the final location
			appendAndRemove(uploadTempPath, uploadFinalPath, function (err) {
				throwError(err)
				append()
			})
		else
			append()
	})
}

function cancelUpload(uploadId, answer, user) {
	_db.collection("uploads").findOne({localName: uploadId, user: user.name}, function (err, upload) {
		throwError(err)
		if (upload) {
			// Remove the file
			fs.unlink(config.tempFolder+upload.localName, function () {})
			
			// Remove from the database
			_db.collection("uploads").remove({localName: uploadId, user: user.name}, throwError)
			
			console.log("[server] upload %s canceled", uploadId)
		}
		answer()
	})
}

function commitUpload(uploadId, answer, user) {
	// Check the session in the database
	_db.collection("uploads").findAndRemove({localName: uploadId, user: user.name}, [], function (err, upload) {
		throwError(err)
		if (!upload) return answer(new aP.Exception(E_INVALID_SESSION))
		
		// Check the size
		if (upload.receivedChunks != Math.ceil(upload.size/CHUNK_SIZE))
			return answer(new aP.Exception(E_WRONG_SIZE))
		
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
}

function removeFile(filePath, answer, user) {
	_db.collection("files").update({path: filePath, user: user.name}, {$set: {old: true}}, throwError)
	
	console.log("[server] file removed: %s", filePath.toString("hex"))
	
	answer()
}

// ((Buffer path, (uint size, uint mtime, string id)[] versions)[] files)
function getFilesInfo(answer, user) {
	var query = {user: user.name}
	var fields = {size: "$size", mtime: "$mtime", id: "$localName"}
	_db.collection("files").aggregate([
		{$match: query},
		{$group: {_id: "$path", versions: {$push: fields}}}
	], function (err, files) {
		throwError(err)
		
		// Convert to the format (B(uus))
		var array = new aP.DataArray("B(uus)")
		files.forEach(function (file) {
			var data = new aP.Data
			data.addBuffer(file._id.buffer)
			
			var versions = new aP.DataArray("uus")
			file.versions.forEach(function (version) {
				var data = new aP.Data
				data.addUint(version.size)
				data.addUint(version.mtime)
				data.addString(version.id)
				versions.addData(data)
			})
			data.addDataArray(versions)
			array.addData(data)
		})
		
		answer(array)
	})
}

// Return the (Buffer) sha1 salted hash of the given (aP.Token) password
function hashPassword(pass) {
	var hash = crypto.createHash("sha1")
	hash.write("sitegui-backuper")
	hash.end(pass.buffer)
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
