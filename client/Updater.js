"use strict"

// Control the update process in the client side

var aP = require("async-protocol")
var net = require("net")
var fs = require("fs")
var crypto = require("crypto")
var path = require("path")
var spawn = require('child_process').spawn

// Set-up async context
var cntxt = new aP
cntxt.registerException("#8 invalidVersion")
cntxt.registerException("#9 invalidFile")
cntxt.registerClientCall("#11 getCurrentVersion -> version: string")
cntxt.registerClientCall("#12 getUpdateFileList(version: string) -> files[]: (name: string, mode: uint)")
cntxt.registerClientCall("#13 getUpdatedFile(file: string, version: string) -> data: Buffer, hash: Buffer")

var config = require("./Configer.js")("config.ini")

// Tell the version should be updated
module.exports.setNeedUpdate = function (version) {
	if (_version != version) {
		// Kick in the whole process
		_version = version
		_files = null
		if (!_updating) {
			// Start the connection cicle
			setInterval(reconnect, config.updater.reconnectionTime)
			reconnect()
		}
		_updating = true
	}
}

// Return whether this version is outdated
module.exports.isUpdating = function () {
	return _updating
}

var _updating = false // whether the process has started
var _version = null // the version to update to (as string)
var _conn = null // the server connection
var _files = null // an array of objects with keys "name" and "mode"
var _modes = null // the final object of modes for each file

var UPDATER_DUMP = "updater.dump"
var TEMP_FOLDER = "tempUpdater/"
var MODE_KEEP = 0 // don't update in the client side
var MODE_REPLACE = 1 // replace by the lastest version
var MODE_CONFIG_MERGE = 2 // merge config files

// Make the connection to the server
function reconnect() {
	if (!_conn) {
		_conn = net.connect({port: config.connect.port, host: config.connect.host})
		_conn.once("error", function () {
			_conn = null
		})
		_conn.once("connect", function () {
			_conn.removeAllListeners()
			_conn = cntxt.wrapSocket(_conn)
			_conn.once("close", function () {
				_conn = null
			})
			stepProcess()
		})
	}
}

// Make a new step in the update process
function stepProcess() {
	if (!_conn)
		;
	else if (!_version)
		getVersion()
	else if (!_files)
		getFileList()
	else if (_files.length)
		downloadFile()
	else
		install()
}

// Get the lastest version from the server
function getVersion() {
	_conn.call("getCurrentVersion", null, function (err, result) {
		if (result) {
			_version = result.version
			stepProcess()
		}
	})
}

// Get the file list from the server
function getFileList() {
	_conn.call("getUpdateFileList", {version: _version}, function (err, result) {
		if (err && err.name == "invalidVersion") {
			// Restart the process
			_version = _files = null
			stepProcess()
		} else if (result) {
			_files = result.files
			_modes = Object.create(null)
			clearFolder()
			stepProcess()
		} else if (_conn)
			_conn.close()
	})
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
	createDir(TEMP_FOLDER)
	clear(TEMP_FOLDER)
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

// Download one file from the queue
function downloadFile() {
	var file = _files.pop()
	_modes[file.name] = file.mode
	if (file.mode == MODE_REPLACE || file.mode == MODE_CONFIG_MERGE)
		_conn.call("getUpdatedFile", {version: _version, file: file.name}, function (err, result) {
			var hash
			if (err && err.name == "invalidVersion") {
				// Restart the process
				_version = _files = null
				stepProcess()
			} else if (result) {
				hash = crypto.createHash("sha1")
				hash.end(result.data)
				if (hash.read().toString("hex") != result.hash.toString("hex"))
					// Try this file again
					_files.push(file)
				else
					// Save to temp folder
					writeFile(path.join(TEMP_FOLDER, file.name), result.data)
				stepProcess()
			} else if (_conn)
				_conn.close()
		})
	else if (file.mode == MODE_KEEP)
		// KEEP mode
		stepProcess()
}

// Update ready to be installed
function install() {
	fs.writeFileSync(UPDATER_DUMP, JSON.stringify(_modes))
	
	var out = fs.openSync("install.log", "a")
	var err = fs.openSync("install.log", "a")
	
	// Start the install process
	spawn("node", [path.resolve("install.js")], {
		detached: true,
		stdio: ["ignore", out, err]
	})
	
	// Shutdown this process
	setTimeout(function () {
		process.abort()
	}, 3e3)
}

// Save the given data to a file in the given path (sync)
// Create all necessary dirs
function writeFile(finalPath, data) {
	// Create the necessary dirs
	var auxPath = "", i
	finalPath = finalPath.split(path.sep)
	for (i=0; i<finalPath.length-1; i++)
		createDir(auxPath += finalPath[i]+"/")
	
	// Save the file
	finalPath = finalPath.join("/")
	fs.writeFileSync(finalPath, data)
}
