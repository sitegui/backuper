"use strict"

// Manage the server for the web interface

var aP = require("async-protocol")

var cntxt = new aP

cntxt.registerException("#1 serverIsDown")

cntxt.registerServerCall("#1 uploaderProgress(connected: boolean, queueLength: uint, file: string, size: uint, progress: float)")
cntxt.registerServerCall("#2 restoreProgress(id: string, numFiles: uint)")
cntxt.registerServerCall("#3 restoreError(id: string, error: string)")

var config = require("./config.js").ui
var http = require("http")
var path = require("path")
var parseUrl = require("url").parse
var fs = require("fs")
var Tree = require("./Tree.js")

var types = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".png": "image/png",
	".txt": "text/plain"
}

var _watcher, _uploader, _downloader
var _conns = [] // current ws connections

// Start the server
// Watcher and Uploader should be the other two loaded modules
exports.init = function (Watcher, Uploader, Downloader) {
	_watcher = Watcher
	_uploader = Uploader
	_downloader = Downloader
	
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
	cntxt.createWSServer(function (conn) {
		_conns.push(conn)
		conn.once("close", function () {
			var pos = _conns.indexOf(conn)
			if (pos != -1)
				_conns.splice(pos, 1)
		})
	}).listen(config.wsPort)
	
	// Expose the used port to JS
	fs.writeFile("ui/port.js", "var _port = "+config.wsPort, function (err) {
		if (err) throw err
	})
	
	// Set the listener for Uploader activity
	_uploader.on("update", function () {
		if (_conns.length) {
			var data = _uploader.getStatus()
			_conns.forEach(function (conn) {
				conn.call("uploaderProgress", data)
			})
		}
	})
	
	// Set listeners for Downloader activity
	_downloader.on("taskUpdate", function (taskId, numFiles) {
		_conns.forEach(function (conn) {
			conn.call("restoreProgress", {id: taskId, numFiles: numFiles})
		})
	})
	_downloader.on("taskError", function (taskId, errStr) {
		_conns.forEach(function (conn) {
			conn.call("restoreError", {id: taskId, error: errStr})
		})
	})
}

cntxt.registerClientCall("#1 getUploaderStatus -> connected: boolean, queueLength: uint, file: string, size: uint, progress: float", function (args, answer) {
	answer(_uploader.getStatus())
})

cntxt.registerClientCall("#2 getTree -> tree: string", function (args, answer) {
	// First fetch the server tree
	_uploader.getServerTree(function (serverTree) {
		// Fetch other trees
		var watcherTree = _watcher.getTree()
		var uploaderTree = _uploader.getTree()
		
		// Mix and return
		var tree = mixTree(serverTree, watcherTree, uploaderTree)
		answer({tree: JSON.stringify(tree)})
	})
})

cntxt.registerClientCall("#3 getWatchedFolders -> folders[]: (name: string, files: uint), lastCicleTime: uint", function (args, answer) {
	answer(_watcher.getFoldersInfo())
})

cntxt.registerClientCall("#4 addWatchFolder(folder: string) -> folders[]: (name: string, files: uint), lastCicleTime: uint", function (args, answer) {
	_watcher.addFolder(args.folder)
	answer(_watcher.getFoldersInfo())
})

cntxt.registerClientCall("#5 removeWatchFolder(folder: string) -> folders[]: (name: string, files: uint), lastCicleTime: uint", function (args, answer) {
	_watcher.removeFolder(args.folder)
	answer(_watcher.getFoldersInfo())
})

cntxt.registerClientCall("#6 getQuotaUsage -> total: uint, free: uint, softUse: uint", function (args, answer) {
	_uploader.getQuotaUsage(function (result) {
		if (!result)
			return answer(new aP.Exception("serverIsDown"))
		answer(result)
	})
})

cntxt.registerClientCall("#7 getFoldersInDir(dir: string) -> folders[]: string", function (args, answer) {
	fs.readdir(args.dir, function (err, items) {
		var folders = []
		
		if (!err)
			items.forEach(function (item) {
				try {
					if (fs.statSync(path.join(args.dir, item)).isDirectory())
						folders.push(item)
				} catch (e) {}
			})
		
		return answer({folders: folders})
	})
})

cntxt.registerClientCall("#8 getDiskUnits -> units[]: string", function (args, answer) {
	var units = []
	"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(function (unit) {
		try {
			fs.readdirSync(unit+":\\")
			// If no error occurred, then this disk exist
			units.push(unit+":")
		} catch(e) {
		}
	})
	answer({units: units})
})

cntxt.registerClientCall("#9 createDownloadTask(files: string, destination: string) -> id: string, numFiles: uint", function (args, answer) {
	answer(_downloader.createTask(new Tree(JSON.parse(args.files)), args.destination))
})

cntxt.registerClientCall("#10 getRestoreProgress -> tasks[]: (id: string, destination: string, numFiles: uint, errors[]: string)", function (args, answer) {
	answer({tasks: _downloader.getStatus()})
})

cntxt.registerClientCall("#11 cancelRestoreTask(id: string)", function (args, answer) {
	_downloader.cancelTask(args.id)
	answer()
})

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
