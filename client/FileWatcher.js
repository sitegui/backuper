"use strict"

var FileWatcher = new (require("events").EventEmitter)
module.exports = FileWatcher

var path = require("path")
var fs = require("fs")
var crypto = require("crypto")

// Start the watcher
// It'll awake from the saved state (or start from scratch if it doesn't exist)
// config is an object with the keys "dumpFile", "foldersPerStep", "timeBetweenSteps"
// This object emits two events:
// start(), right after the watcher has done starting
// filechange(file), when a file change is detected (file is an absolute path)
FileWatcher.start = function (config) {
	_config = config
	fs.readFile(_config.dumpFile, {encoding: "utf8"}, function (err, data) {
		if (_started)
			throw new Error("FileWatcher has already been started")
		if (err) {
			// Create a new file watcher profile
			console.log("[FileWatcher] creating dump file: "+_config.dumpFile)
			_folders = []
			_queue = {}
			_files = {}
		} else {
			// Get the data from the saved format
			data = JSON.parse(data)
			if (data.format == 1) {
				_folders = data.folders
				_queue = data.queue
				_files = data.files
			} else
				throw new Error("Invalid format")
		}
		_started = true
		FileWatcher.emit("start")
		runStep()
	})
}

// Add a new folder to be watched
FileWatcher.addFolder = function (folder) {
	var i, newFolders = [], newQueue = {}
	
	if (!_started)
		throw new Error("FileWatcher hasn't started")
	
	folder = path.resolve(folder+path.sep)
	
	for (i=0; i<_folders.length; i++)
		if (folder.indexOf(_folders[i]) == 0)
			// If this folder is a descendant of any registered folder, just ignore the action
			return
		else if (_folders[i].indexOf(folder) != 0) {
			// Remove descendants
			newFolders.push(_folders[i])
			newQueue[_folders[i]] = _queue[_folders[i]]
		}
	newFolders.push(folder)
	newQueue[folder] = []
	_folders = newFolders
	_queue = newQueue
}

// Remove a folder from the watching list
FileWatcher.removeFolder = function (folder) {
	var pos
	
	if (!_started)
		throw new Error("FileWatcher hasn't started")
	
	folder = path.resolve(folder)
	pos = _folders.indexOf(folder)
	if (pos != -1) {
		_folders.splice(pos, 1)
		delete _queue[folder]
	}
}

// Return an array with the absolute path of all folders beeing watched now
FileWatcher.getFolders = function () {
	if (!_started)
		throw new Error("FileWatcher hasn't started")
	return _folders
}

/*
Internals
*/
var _folders // array of absolute paths
var _queue // object, where each key is an element of _folders and each values is an array of absolute paths inside the key folder
var _config // the config object (with keys "dumpFile", "foldersPerStep", "timeBetweenSteps")
var _started = false // flag if this module has been started
var _files // the toUTCString(modificationTime) for each know file, stored as sha1(fileName)

// Save the current data into the disk
var saveData = function () {
	var data = {}
	data.format = 1
	data.folders = _folders
	data.queue = _queue
	data.files = _files
	fs.writeFile(_config.dumpFile, JSON.stringify(data), function (err) {
		if (err)
			console.error("[FileWatcher] Error while trying to save data into "+_config.dumpFile)
	})
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
			readFolderFromQueue(queue)
			openedFolders++
		}
	}
	
	// Schedule the next step
	if (!openedFolders) {
		// Restart all queues
		for (root in _queue)
			_queue[root] = [root]
		console.log("[FileWatcher] end of cicle")
	}
	setTimeout(runStep, _config.timeBetweenSteps)
}

// Read the content of the given folder and queue new itens
var readFolderFromQueue = function (queue) {
	var folder = queue.shift()
	fs.readdir(folder, function (err, files) {
		if (!err) {
			files.forEach(function (file) {
				// Ignore files starting with "."
				if (file.charAt(0) == ".")
					return
				
				// Get absolute path
				file = path.join(folder, file)
				fs.stat(file, function (err, stats) {
					var hash
					if (err) return
					if (stats.isFile()) {
						hash = sha1(file)
						if (!(hash in _files) || _files[hash] != hashDate(stats.mtime)) {
							// Update the data and execute the callback
							_files[hash] = hashDate(stats.mtime)
							FileWatcher.emit("filechange", file)
						}
					} else if (stats.isDirectory()) {
						// Add to the original queue
						queue.push(file)
					}
				})
			})
		}
	})
}

// Return the sha1 hash of the given string
function sha1(string) {
	var hash = crypto.createHash("sha1")
	hash.end(string)
	return hash.read().toString("base64").substr(0, 27)
}

// Convert a date to a number (based on UTC time)
function hashDate(date) {
	var d, m, y, h, i, s
	d = date.getUTCDate()
	m = date.getUTCMonth()
	y = date.getUTCFullYear()
	h = date.getUTCHours()
	i = date.getUTCMinutes()
	s = date.getUTCSeconds()
	return s+60*(i+60*(h+24*(d+31*(m+12*y))))
}
