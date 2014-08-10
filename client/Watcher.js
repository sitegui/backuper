"use strict";

var Watcher = new (require("events").EventEmitter)
module.exports = Watcher

var path = require("path")
var fs = require("fs")
var Tree = require("./Tree.js")
var _dumpFile = "watcher.dump"

// Start the watcher
// It'll awake from the saved state (or start from scratch if it doesn't exist)
// config is an object with the keys "foldersPerStep", "timeBetweenSteps", "ignore"
// This object emits two events:
// filechange(file), when a file change is detected (file is an absolute path)
// fileremove(file), when detects a file was deleted (file is an absolute path)
Watcher.start = function (config) {
	_config = config
	fs.readFile(_dumpFile, {encoding: "utf8"}, function (err, data) {
		if (_started)
			throw new Error("Watcher has already been started")
		if (err) {
			// Create a new file watcher profile
			console.log("[Watcher] creating dump file: "+_dumpFile)
			_folders = []
			_queue = {}
			_tree = new Tree()
			_lastCicleTime = 0
		} else {
			// Get the data from the saved format
			data = JSON.parse(data)
			if (data.format == 1) {
				_folders = data.folders
				_queue = data.queue
				_tree = new Tree(data.tree)
				_lastCicleTime = data.lastCicleTime
			} else
				throw new Error("Invalid format")
		}
		_started = true
		runStep()
	})
}

// Add a new folder to be watched
Watcher.addFolder = function (folder) {
	var i, newFolders = [], newQueue = {}
	
	if (!_started)
		throw new Error("Watcher hasn't started")
	
	folder = path.resolve(folder+path.sep)
	
	for (i=0; i<_folders.length; i++)
		if (folder.indexOf(_folders[i]) == 0)
			// If this folder is a descendant of any registered folder, just ignore the action
			return
		else if (_folders[i].indexOf(folder) != 0) {
			// Remove descendants (because it's redundant)
			newFolders.push(_folders[i])
			newQueue[_folders[i]] = _queue[_folders[i]]
		}
	newFolders.push(folder)
	newQueue[folder] = [""]
	_folders = newFolders
	_queue = newQueue
	_lastCicleTime = 0
	saveData()
}

// Remove a folder from the watching list
Watcher.removeFolder = function (folder) {
	var pos
	
	if (!_started)
		throw new Error("Watcher hasn't started")
	
	folder = path.resolve(folder)
	pos = _folders.indexOf(folder)
	if (pos != -1) {
		// Remove from the list and queue
		_folders.splice(pos, 1)
		delete _queue[folder]
		
		// Remove from the tree
		var treeFolder = _tree.getFolder(folder)
		treeFolder.getAllFiles().forEach(function (file) {
			Watcher.emit("fileremove", path.join(folder, file))
		})
		_tree.getFolder(path.dirname(folder)).removeItem(path.basename(folder))
	}
	_lastCicleTime = 0
	saveData()
}

// Return an array with the absolute path of all folders beeing watched now
Watcher.getFolders = function () {
	if (!_started)
		throw new Error("Watcher hasn't started")
	return _folders.slice(0)
}

// Return {folders[]: {name: string, files: uint}, lastCicleTime: uint}
Watcher.getFoldersInfo = function () {
	if (!_started)
		throw new Error("Watcher hasn't started")
	var folders = _folders.map(function (folder) {
		var files = _tree.getFolder(folder).getNumFiles()
		return {name: folder, files: files}
	})
	return {folders: folders, lastCicleTime: _lastCicleTime}
}

// Return an copy of the internal tree
// Each leaf is an int to indicate the mtime of the watched file
Watcher.getTree = function () {
	return _tree.toJSON()
}

// Tell watcher to forget a given file for now
// In the next cicle, this file will be detected as new
Watcher.forgetFile = function (file) {
	var folder = _tree.getFolder(path.dirname(file))
	folder.removeItem(path.basename(file))
}

/*
Internals
*/
var _lastCicleTime // the timestamp of the last time the cicle ended
var _folders // array of absolute paths
var _queue // object, where each key is an element of _folders and each values is an array of absolute paths inside the key folder
var _config // the config object (with keys "foldersPerStep", "timeBetweenSteps")
var _started = false // flag if this module has been started
var _tree // an Tree instance to store the mtime of each file

// Save the current data into the disk
var saveData = function () {
	var data = {}
	data.format = 1
	data.folders = _folders
	data.queue = _queue
	data.tree = _tree
	data.lastCicleTime = _lastCicleTime
	try {
		fs.writeFileSync(_dumpFile, JSON.stringify(data))
	} catch (e) {
		console.error("[Watcher] Error while trying to save data into "+_dumpFile)
	}
}

// Execute each step
var runStep = function () {
	var openedFolders = 0, queue, root
	
	saveData()
	for (root in _queue) {
		queue = _queue[root]
		// Unqueue up to _config.foldersPerStep folders
		// Pick their content and queue subfolders
		while (openedFolders < _config.foldersPerStep && queue.length) {
			readFolderFromQueue(root, queue)
			openedFolders++
		}
	}
	
	// Schedule the next step
	if (!openedFolders) {
		// Restart all queues
		for (root in _queue)
			_queue[root] = [""]
		console.log("[Watcher] end of cicle (took "+(Date.now()-_lastCicleTime)+" ms)")
		_lastCicleTime = Date.now()
		_tree.clear()
	}
	setTimeout(runStep, _config.timeBetweenSteps)
}

// Read the content of the given folder and queue new items
var readFolderFromQueue = function (root, queue) {
	var folder = path.join(root, queue.pop())
	var folderTree = _tree.getFolder(folder)
	fs.readdir(folder, function (err, items) {
		if (!err) {
			// Filter out the ignored items
			items = items.filter(function (item) {
				return _config.ignore.every(function (regexp) {
					return !item.match(regexp)
				})
			})
			
			// Check for deleted items
			folderTree.getItems().filter(function (item) {
				return items.indexOf(item) == -1
			}).forEach(function (item) {
				// Update the tree and warn the uploader
				if (folderTree.isFile(item))
					Watcher.emit("fileremove", path.join(folder, item))
				else
					folderTree.getFolder(item).getAllFiles().forEach(function (file) {
						Watcher.emit("fileremove", path.join(folder, item, file))
					})
				folderTree.removeItem(item)
			})
			
			// Watch all considered items
			items.forEach(function (item) {
				// Get absolute path
				var itemPath = path.join(folder, item)
				fs.stat(itemPath, function (err, stats) {
					var hash
					if (err) return
					if (stats.isFile()) {
						hash = hashDate(stats.mtime)
						if (folderTree.getFileInfo(item) != hash) {
							// Update the data and execute the callback
							folderTree.setFileInfo(item, hash)
							Watcher.emit("filechange", itemPath)
						}
					} else if (stats.isDirectory()) {
						// Add to the original queue
						queue.push(itemPath.substr(root.length+1))
					}
				})
			})
		}
	})
}

// Convert a date to a number (based on UTC time)
function hashDate(date) {
	var d, m, y, h, i
	d = date.getUTCDate()
	m = date.getUTCMonth()
	y = date.getUTCFullYear()-1990
	h = date.getUTCHours()
	i = date.getUTCMinutes()
	return i+60*(h+24*(d+31*(m+12*y)))
}
