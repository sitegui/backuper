"use strict"

// Manage the server for the web interface

var config = require("./config.js").ui
var http = require("http")
var path = require("path")
var parseUrl = require("url").parse
var fs = require("fs")
var aP = require("async-protocol")
var net = require("net")

var types = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".png": "image/png",
	".txt": "text/plain"
}

var _watcher, _uploader, _aPServer
var _conns = [] // current ws connections

// Set-up protocol calls
var E_SERVER_IS_DOWN = aP.registerException(100)
var CC_GET_UPLOADER_STATUS = aP.registerClientCall(100, "", "busuf")
var CC_GET_TREE = aP.registerClientCall(101, "", "s")
var CC_GET_WATCHED_FOLDERS = aP.registerClientCall(102, "", "(su)")
var CC_ADD_WATCH_FOLDER = aP.registerClientCall(103, "s", "(su)")
var CC_REMOVE_WATCH_FOLDER = aP.registerClientCall(104, "s", "(su)")
var CC_GET_QUOTA_USAGE = aP.registerClientCall(105, "", "uuu", [E_SERVER_IS_DOWN])
var SC_UPLOADER_PROGRESS = aP.registerServerCall(100, "busuf")

// Start the server
// Watcher and Uploader should be the other two loaded modules
exports.init = function (Watcher, Uploader) {
	_watcher = Watcher
	_uploader = Uploader
	
	http.createServer(function (req, res) {
		// Get the target file path
		var filePath = parseUrl(req.url).pathname
		if (filePath[filePath.length-1] == "/")
			filePath += "index.html"
		filePath = path.join("ui", filePath)
		
		// Get the mime type
		var type = path.extname(filePath).toLowerCase()
		type = type in types ? types[type] : "application/octet-stream"
		
		// Try to answer the request
		var stream = fs.createReadStream(filePath)
		stream.once("error", function () {
			res.writeHead(404, {"Content-Type": "text/html; charset=utf-8"})
			res.end("Not Found")
		})
		stream.once("readable", function () {
			res.writeHead(200, {"Content-Type": type+"; charset=utf-8"})
			stream.pipe(res)
		})
	}).listen(config.port)
	
	// Set-up the async-protocol server
	_aPServer = net.createServer(function (conn) {
		conn = new aP(conn)
		conn.on("error", function () {})
		conn.on("call", function (type, data, answer) {
			if (type == CC_GET_UPLOADER_STATUS)
				getUploaderStatus(answer)
			else if (type == CC_GET_TREE)
				getTree(answer)
			else if (type == CC_GET_WATCHED_FOLDERS)
				getWatchedFolders(answer)
			else if (type == CC_ADD_WATCH_FOLDER)
				addWatchFolder(data, answer)
			else if (type == CC_REMOVE_WATCH_FOLDER)
				removeWatchFolder(data, answer)
			else if (type == CC_GET_QUOTA_USAGE)
				getQuotaUsage(answer)
		})
		
		_conns.push(conn)
		conn.once("close", function () {
			var pos = _conns.indexOf(conn)
			if (pos != -1)
				_conns.splice(pos, 1)
		})
	})
	_aPServer.listen(0)
	
	// Set-up the webSocket gate
	aP.createGate(function () {
		return net.connect(_aPServer.address().port)
	}).listen(config.wsPort)
	
	// Expose the used port to JS
	fs.writeFile("ui/port.js", "var _port = "+config.wsPort, function (err) {
		if (err) throw err
	})
	
	// Set the listener for Uploader activity
	_uploader.on("update", function () {
		if (_conns.length) {
			var data = uploaderStatus2Data()
			_conns.forEach(function (conn) {
				conn.sendCall(SC_UPLOADER_PROGRESS, data)
			})
		}
	})
}

function getUploaderStatus(answer) {
	answer(uploaderStatus2Data())
}

// Return the upload status in a aP.Data object
function uploaderStatus2Data() {
	var status = _uploader.getStatus()
	var data = new aP.Data
	data.addBoolean(status.connected)
	data.addUint(status.queueLength)
	data.addString(status.file)
	data.addUint(status.size)
	data.addFloat(status.progress)
	return data
}

function getTree(answer) {
	// First fetch the server tree
	_uploader.getServerTree(function (serverTree) {
		// Fetch other trees
		var watcherTree = _watcher.getTree()
		var uploaderTree = _uploader.getTree()
		
		// Mix and return
		answer(JSON.stringify(mixTree(serverTree, watcherTree, uploaderTree)))
	})
}

function getWatchedFolders(answer) {
	var info = _watcher.getFoldersInfo()
	var data = new aP.DataArray("su")
	info.forEach(function (folder) {
		data.addData(new aP.Data().addString(folder.name).addUint(folder.files))
	})
	answer(data)
}

function addWatchFolder(folder, answer) {
	_watcher.addFolder(folder)
	getWatchedFolders(answer)
}

function removeWatchFolder(folder, answer) {
	_watcher.removeFolder(folder)
	getWatchedFolders(answer)
}

function getQuotaUsage(answer) {
	_uploader.getQuotaUsage(function (result) {
		if (!result)
			return answer(new aP.Exception(E_SERVER_IS_DOWN))
		answer(new aP.Data().addUint(result.total).addUint(result.free).addUint(result.softUse))
	})
}

// Join the tree from the given sources
// Send undefined to ignore any of them
// server===null means server did not answered
// server===undefined means the server doesn't have this folder
function mixTree(server, watcher, uploader) {
	var tree = {
		items: Object.create(null),
		watcher: Boolean(watcher),
		uploader: Boolean(uploader)
	}
	
	// Get sub-items names
	var serverItems = server ? Object.keys(server) : []
	var watcherItems = watcher ? Object.keys(watcher) : []
	var uploaderItems = uploader ? Object.keys(uploader) : []
	
	// Get the union
	var items = serverItems.slice(0)
	var addItemToSet = function (item) {
		if (items.indexOf(item) == -1)
			items.push(item)
	}
	watcherItems.forEach(addItemToSet)
	uploaderItems.forEach(addItemToSet)
	
	// Add each sub-item
	items.forEach(function (item) {
		if (item[0] == "/") {
			// A folder
			var serverItem = server===null ? null : (server ? server[item] : undefined)
			var watcherItem = watcher ? watcher[item] : undefined
			var uploaderItem = uploader ? uploader[item] : undefined
			tree.items[item.substr(1)] = mixTree(serverItem, watcherItem, uploaderItem)
		} else {
			// A file
			tree.items[item] = {
				watcher: watcher ? item in watcher : false,
				uploader: uploader ? item in uploader : false,
				server: server===null ? null : (server && item in server ? server[item] : [])
			}
		}
	})
	
	return tree
}
