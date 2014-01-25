"use strict"

// Control the update logic in the server side

var Exception = require("async-protocol").Exception
var fs = require("fs")
var FILES_FOLDER = "clientFiles/"
var ORIGINAL_FOLDER = "../client/"
var crypto = require("crypto")
var path = require("path")

var MODE_KEEP = 0 // don't update in the client side
var MODE_REPLACE = 1 // replace by the lastest version
var MODE_CONFIG_MERGE = 2 // merge config files

// Global state
var _version = ""
var _files = {} // each object has the keys "hash", "mode"

// Init the module and use the given asyncProtocol context
module.exports.init = function (cntxt) {
	clearFolder()
	loadVersion()
	registerCalls(cntxt)
}

// Clear the FILES_FOLDER
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
	createDir(FILES_FOLDER)
	clear(FILES_FOLDER)
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

// Load the current version info (synchronous)
function loadVersion() {
	// Copy files to final location
	var scan = function (path, prefix) {
		fs.readdirSync(path).forEach(function (item) {
			if (fs.statSync(path+"/"+item).isDirectory())
				// Recursive scan
				scan(path+"/"+item, prefix+item+"/")
			else
				loadFile(path+"/"+item, prefix+item)
		})
	}
	scan(ORIGINAL_FOLDER, "")
	
	// Get version id
	_version = JSON.parse(fs.readFileSync(ORIGINAL_FOLDER+"package.json", {encoding: "utf8"})).version
}

// Aux function for loadVersion
// Copy the file to server folder and get its hash (synchronous)
function loadFile(originalPath, finalPath) {
	// Files that must not be updated
	if (finalPath.match(/\.(dump|log)$/) || finalPath == "keys") {
		_files[finalPath] = {mode: MODE_KEEP}
		return
	}
	
	// Create the necessary dirs
	var auxPath = "", i
	var finalLocalPath = path.join(FILES_FOLDER, finalPath).split(path.sep)
	for (i=0; i<finalLocalPath.length-1; i++)
		createDir(auxPath += finalLocalPath[i]+"/")
	
	// Save the file
	var data = fs.readFileSync(originalPath)
	finalLocalPath = finalLocalPath.join("/")
	fs.writeFileSync(finalLocalPath, data)
	
	// Hash it
	var hash = crypto.createHash("sha1")
	hash.end(data)
	hash = hash.read()
	
	var mode = finalPath.match(/\.ini$/) ? MODE_CONFIG_MERGE : MODE_REPLACE
	_files[finalPath] = {hash: hash, mode: mode}
}

// Register calls to the given aP context
function registerCalls(cntxt) {
	cntxt.registerException("#8 invalidVersion")
	cntxt.registerException("#9 invalidFile")
	
	cntxt.registerClientCall("#11 getCurrentVersion -> version: string", function (args, answer) {
		answer({version: _version})
	})
	
	cntxt.registerClientCall("#12 getUpdateFileList(version: string) -> files[]: (name: string, mode: uint)", function (args, answer) {
		var files = [], name
		if (args.version != _version)
			return answer(new Exception("invalidVersion"))
		for (name in _files)
			files.push({name: name, mode: _files[name].mode})
		answer({files: files})
	})
	
	cntxt.registerClientCall("#13 getUpdatedFile(file: string, version: string) -> data: Buffer, hash: Buffer", function (args, answer) {
		if (args.version != _version)
			return answer(new Exception("invalidVersion"))
		var info = _files[args.file]
		if (!info || info.mode == MODE_KEEP)
			return answer(new Exception("invalidFile"))
		fs.readFile(FILES_FOLDER+args.file, function (err, data) {
			throwError(err)
			answer({data: data, hash: info.hash})
		})
	})
}

// If not null, throw the given error
function throwError(err) {
	if (err) {
		console.trace()
		throw err
	}
}
