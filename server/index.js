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
var CC_START_UPLOAD = aP.registerClientCall(2, "(B)uu", "s", [E_NOT_LOGGED_IN, E_OUT_OF_SPACE])
var CC_START_CHUNK_UPLOAD = aP.registerClientCall(3, "sB", "s", [E_NOT_LOGGED_IN, E_INVALID_SESSION])
var CC_COMMIT_CHUNK = aP.registerClientCall(4, "s", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_CORRUPTED_DATA])
var CC_CANCEL_UPLOAD = aP.registerClientCall(5, "s", "", [E_NOT_LOGGED_IN])
var CC_COMMIT_UPLOAD = aP.registerClientCall(6, "s", "", [E_NOT_LOGGED_IN, E_INVALID_SESSION, E_WRONG_SIZE])
var CC_REMOVE_FILE = aP.registerClientCall(7, "(B)", "", [E_NOT_LOGGED_IN])

var CHUNK_SIZE = 1*1024*1024 // 1 MiB
var TEMP_FOLDER = "data"+path.sep+"temp"+path.sep
var CHUNKS_FOLDER = "data"+path.sep+"temp"+path.sep+"chunks"+path.sep

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
				startUpload(data[0], data[1], data[2], answer, conn.user)
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
			stream = fs.createWriteStream(CHUNKS_FOLDER+id)
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
	if (err) throw err
	_db = db
	
	// Set-up the database
	db.collection("users").ensureIndex({userName: 1}, {unique: true}, function (err) {
		if (err) throw err
	})
})

// Try to login the user
function login(userName, password, answer, conn) {
	console.log("login", userName, password)
	_db.collection("users").findOne({userName: userName, password: hashPassword(password)}, function (err, doc) {
		if (err) throw err
		if (!doc)
			answer(new aP.Exception(E_LOGIN_ERROR))
		else {
			answer()
			conn.user = doc
		}
	})
}

function startUpload(filePath, mtime, size, answer, user) {
	console.log("startUpload", filePath.map(function (each) {
		return each.toString("hex")
	}).join(path.sep), mtime, size)
	
	// TODO: check user quota
	
	var data = {
		localName: getRandomHexString(),
		user: user.userName,
		filePath: filePath,
		mtime: mtime,
		size: size,
		receivedChunks: 0
	}
	_db.collection("uploads").insert(data, function (err) {
		if (err) throw err
		answer(data.localName)
	})
}

function startChunkUpload(uploadId, hash, answer, user) {
	console.log("startChunkUpload", uploadId, hash)
	
	_db.collection("uploads").findOne({localName: uploadId, user: user.userName}, function (err, upload) {
		var chunkId
		if (err) throw err
		if (!upload)
			return answer(new aP.Exception(E_INVALID_SESSION))
		chunkId = getRandomHexString()
		_chunks[chunkId] = {hash: hash, upload: upload}
		answer(chunkId)
	})
}

function commitChunk(chunkId, answer, user) {
	console.log("commitChunk", chunkId)
	
	// Get chunk info
	var chunk = _chunks[chunkId]
	if (!chunk || chunk.upload.user != user.userName)
		return answer(new aP.Exception(E_INVALID_SESSION))
	delete _chunks[chunkId]
	
	// Check the data
	fs.readFile(CHUNKS_FOLDER+chunkId, function (err, data) {
		if (err)
			return answer(new aP.Exception(E_CORRUPTED_DATA))
		
		// Check the hash
		var hash = crypto.createHash("sha1")
		hash.end(data)
		hash = hash.read()
		if (hash.toString("hex") != chunk.hash.toString("hex"))
			return answer(new aP.Exception(E_CORRUPTED_DATA))
		
		// Append to the upload session file
		fs.appendFile(TEMP_FOLDER+chunk.upload.localName, data, function (err) {
			if (err)
				answer(new aP.Exception(E_CORRUPTED_DATA))
			else {
				// Update the number of received chunks in the db
				var query = {user: user.userName, localName: chunk.upload.localName}
				_db.collection("uploads").update(query, {$inc: {receivedChunks: 1}}, function (err) {
					if (err) throw err
				})
				
				// Done
				answer()
			}
		})
		fs.unlink(CHUNKS_FOLDER+chunkId, function (err) {
			if (err) throw err
		})
	})
}

function cancelUpload(uploadId, answer, user) {
	console.log("cancelUpload", uploadId)
	
	_db.collection("uploads").findOne({localName: uploadId, user: user.userName}, function (err, upload) {
		if (err) throw err
		if (upload) {
			// Remove the file
			fs.unlink(TEMP_FOLDER+upload.localName, function () {})
			
			// Remove from the database
			_db.collection("uploads").remove({localName: uploadId, user: user.userName}, function (err) {
				if (err) throw err
			})
		}
		answer()
	})
}

function commitUpload(uploadId, answer, user) {
	console.log("commitUpload", uploadId)
	
	// Check the session in the database
	_db.collection("uploads").findAndRemove({localName: uploadId, user: user.userName}, [], function (err, upload) {
		if (err) throw err
		if (!upload) return answer(new aP.Exception(E_INVALID_SESSION))
		
		// Check the size
		if (upload.receivedChunks != Math.ceil(upload.size/CHUNK_SIZE))
			return answer(new aP.Exception(E_WRONG_SIZE))
		
		// Move the file
		fs.rename(TEMP_FOLDER+upload.localName, user.localFolder+upload.localName, function (err) {
			if (err) return answer(new aP.Exception(E_INVALID_SESSION))
			answer()
		})
		
		// Save in the database
		// TODO: update version and old flag
		var file = {
			user: user.userName,
			path: upload.filePath,
			size: upload.size,
			mtime: upload.mtime,
			version: 17,
			old: false,
			localName: user.localFolder+upload.localName
		}
		_db.collection("files").insert(file, function (err) {
			if (err) throw err
		})
	})
}

function removeFile(filePath, answer, user) {
	console.log("removeFile", filePath)
	
	// TODO
	
	answer()
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
