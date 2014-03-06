"use strict"

// Install the downloaded version
// All files should be saved in the tempUpdater folder
// and the meta-data should be placed in updater.dump

var fs = require("fs")
var path = require("path")
var spawn = require('child_process').spawn
var Configer = require("./Configer.js")
var UPDATER_DUMP = "updater.dump"
var TEMP_FOLDER = "tempUpdater/"
var MODE_KEEP = 0 // don't update in the client side
var MODE_REPLACE = 1 // replace by the lastest version
var MODE_CONFIG_MERGE = 2 // merge config files

console.log("[install.js] "+new Date)

// Wait a little to the parent node process to close
setTimeout(start, 5e3)

function start() {
	var modes = JSON.parse(fs.readFileSync(UPDATER_DUMP, {encoding: "utf8"}))
	
	// Log
	var oldVersion = JSON.parse(fs.readFileSync("package.json", {encoding: "utf8"})).version
	var newVersion = JSON.parse(fs.readFileSync(TEMP_FOLDER+"package.json", {encoding: "utf8"})).version
	console.log("Updating from version "+oldVersion+" to "+newVersion)
	
	removeOld(modes)
	replaceAndMerge(modes)
	clearFolder()
	restart()
}

// Remove files that were not told to be keeped (sync)
function removeOld(modes) {
	var scan = function (path, prefix) {
		fs.readdirSync(path).forEach(function (item) {
			if (path == "." && item+"/" == TEMP_FOLDER)
				return
			if (fs.statSync(path+"/"+item).isDirectory())
				scan(path+"/"+item, prefix+item+"/")
			else if (!(prefix+item in modes) || modes[prefix+item] == MODE_REPLACE)
				fs.unlinkSync(path+"/"+item)
		})
	}
	scan(".", "")
}

// Merge config files and place new one in the final position
function replaceAndMerge(modes) {
	var fileName, oldPath
	for (fileName in modes) {
		oldPath = path.join(TEMP_FOLDER, fileName)
		if (modes[fileName] == MODE_CONFIG_MERGE) {
			try {
				// Try to merge
				Configer.merge(fileName, oldPath)
			} catch (e) {
				if (e.code != "ENOENT")
					throw e
			}
			moveFile(oldPath, fileName)
		} else if (modes[fileName] == MODE_REPLACE)
			moveFile(oldPath, fileName)
	}
}

// Clear the temp folder
function clearFolder() {
	var clear = function (path) {
		fs.readdirSync(path).forEach(function (item) {
			if (fs.statSync(path+"/"+item).isDirectory()) {
				// Recursive scan
				clear(path+"/"+item)
				fs.rmdirSync(path+"/"+item)
			} else
				fs.unlinkSync(path+"/"+item)
		})
	}
	clear(TEMP_FOLDER)
	fs.rmdirSync(TEMP_FOLDER)
}

// Create a dir (if necessary)
function createDir(dir) {
	try {
		fs.mkdirSync(dir)
	} catch (e) {
		if (e.code != "EEXIST")
			throw e
	}
}

// Similar to fs.renameSync with file renaming
// Create all necessary dirs
function moveFile(oldPath, newPath) {
	// Create the necessary dirs
	var auxPath = "", i
	newPath = newPath.split(path.sep)
	for (i=0; i<newPath.length-1; i++)
		createDir(auxPath += newPath[i]+"/")
	
	// Save the file
	newPath = newPath.join("/")
	fs.renameSync(oldPath, newPath)
}

function restart() {
	var out = fs.openSync("client.log", "a")
	var err = fs.openSync("client.log", "a")
	
	// Start the install process
	spawn("node", [path.resolve("index.js")], {
		detached: true,
		stdio: ["ignore", out, err]
	})
	
	// Shutdown this process
	setTimeout(function () {
		process.abort()
	}, 3e3)
}
