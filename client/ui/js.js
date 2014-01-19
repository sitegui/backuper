/*global _port, FilesExplorer, Window, FolderPicker, Restore*/

"use strict"

var aP = require("async-protocol-web")

var cntxt = new aP

cntxt.registerException("#1 serverIsDown")

cntxt.registerServerCall("#1 uploaderProgress(connected: boolean, queueLength: uint, file: string, size: uint, progress: float)", function (args, answer) {
	updateUploaderStatus(args)
	answer()
})
cntxt.registerServerCall("#2 restoreProgress(id: string, numFiles: uint)", function (args, answer) {
	Restore.setProgress(args.id, args.numFiles)
	answer()
})
cntxt.registerServerCall("#3 restoreError(id: string, error: string)", function (args, answer) {
	Restore.setError(args.id, args.error)
	answer()
})

cntxt.registerClientCall("#1 getUploaderStatus -> connected: boolean, queueLength: uint, file: string, size: uint, progress: float")
cntxt.registerClientCall("#2 getTree -> tree: string")
cntxt.registerClientCall("#3 getWatchedFolders -> folders[]: (name: string, files: uint), lastCicleTime: uint")
cntxt.registerClientCall("#4 addWatchFolder(folder: string) -> folders[]: (name: string, files: uint), lastCicleTime: uint")
cntxt.registerClientCall("#5 removeWatchFolder(folder: string) -> folders[]: (name: string, files: uint), lastCicleTime: uint")
cntxt.registerClientCall("#6 getQuotaUsage -> total: uint, free: uint, softUse: uint")
cntxt.registerClientCall("#7 getFoldersInDir(dir: string) -> folders[]: string")
cntxt.registerClientCall("#8 getDiskUnits -> units[]: string")
cntxt.registerClientCall("#9 createDownloadTask(files: string, destination: string) -> id: string, numFiles: uint")
cntxt.registerClientCall("#10 getRestoreProgress -> tasks[]: (id: string, destination: string, numFiles: uint, errors[]: string)")
cntxt.registerClientCall("#11 cancelRestoreTask(id: string)")

var _conn

window.onload = function () {
	Window.init()
	_conn = cntxt.connect("ws://localhost:"+_port)
	_conn.onopen = function () {
		_conn.call("getUploaderStatus", null, function (err, result) {
			if (result)
				updateUploaderStatus(result)
		})
		FilesExplorer.init(get("files-path"), get("files-stage"))
		Restore.init(get("tasksStatus"))
		fullUpdate()
	}
	_conn.onclose = function () {
		Window.open("Connection error").textContent = "Please refresh the page to try again"
	}
}

// Reload the tree, the quota and the folder list from the server
// Auto-reload after 5min
function fullUpdate() {
	get("reload-button").style.display = "none"
	_conn.call("getTree", null, function (err, result) {
		if (result) {
			FilesExplorer.setTree(JSON.parse(result.tree))
			get("reload-button").style.display = ""
		}
	})
	
	_conn.call("getWatchedFolders", null, function (err, result) {
		if (result)
			updateWatchedList(result)
	})
	
	get("quota").innerHTML = "<p>Loading...</p>"
	get("quota").className = ""
	_conn.call("getQuotaUsage", null, function (err, result) {
		if (err)
			get("quota").innerHTML = "<p>Unable to reach the server</p>"
		else
			updateQuota(result)
	})
	
	clearTimeout(fullUpdate.interval)
	fullUpdate.interval = setTimeout(fullUpdate, 5*60e3)
}
fullUpdate.interval = null

function get(id) {
	return document.getElementById(id)
}

// Update the info shown in the interface
// obj is an object with the keys "connected", "queueLength", "file" and "progress"
function updateUploaderStatus(obj) {
	var connected = obj.connected
	var queueLength = obj.queueLength
	var file = obj.file
	var progress = obj.progress
	var queueEl = get("upload-queue")
	if (queueLength)
		queueEl.textContent = queueLength+" file"+(queueLength==1 ? "" : "s")+" waiting for upload"
	else
		queueEl.textContent = "No more files in the upload queue"
	
	var progressEl = get("upload-progress")
	if (!file)
		progressEl.textContent = "No current upload"
	else {
		progress = connected ? Math.floor(100*progress)+"%" : "paused"
		progressEl.textContent = "Uploading "
		progressEl.appendChild(getSpanForPath(file))
		progressEl.appendChild(createNode(" ("+progress+")"))
	}
}

// Update the quota display
// obj is an object with the keys "total", "free", "softUse"
function updateQuota(obj) {
	var total = obj.total
	var free = obj.free
	var softUse = obj.softUse
	var quotaEl = get("quota")
	quotaEl.innerHTML = ""
	get("quota").className = "quota"
	var hardEl = createNode("div", "quota-used-hard", bytes2str(total-free-softUse))
	var softEl = createNode("div", "quota-used-soft", bytes2str(softUse))
	var freeEl = createNode("div", "quota-free", bytes2str(free))
	quotaEl.appendChild(hardEl)
	quotaEl.appendChild(softEl)
	quotaEl.appendChild(freeEl)
	hardEl.style.width = 100*(total-free-softUse)/total+"%"
	softEl.style.width = 100*softUse/total+"%"
	freeEl.style.width = 100*free/total+"%"
}

// Update the list of watched folders
// obj is an object with the keys "folders" and "lastCicleTime"
function updateWatchedList(obj) {
	var folders = obj.folders
	var lastCicleTime = obj.lastCicleTime
	var el = get("watch-list")
	el.innerHTML = ""
	
	// Append the folder names list
	folders.forEach(function (folder) {
		var li = createNode("li", "")
		li.appendChild(getSpanForPath(folder.name))
		li.appendChild(createNode(" ("+folder.files+" files) - "))
		var span = createNode("span", "button", "Remove")
		span.onclick = function () {
			_conn.call("removeWatchFolder", {folder: folder.name}, function (err, result) {
				if (result)
					updateWatchedList(result)
			})
			span.onclick = null
		}
		li.appendChild(span)
		
		el.appendChild(li)
	})
	
	// Put the add button
	var li = createNode("li", "")
	var span = createNode("span", "button", "Add")
	span.onclick = function () {
		FolderPicker.pick("Add folder", function (folder) {
			if (folder)
				_conn.call("addWatchFolder", {folder: folder}, function (err, result) {
					if (result)
						updateWatchedList(result)
				})
		})
	}
	li.appendChild(span)
	el.appendChild(li)
	
	// Update last cicle information
	get("last-cicle").textContent = lastCicleTime ? date2str(new Date(lastCicleTime)) : "never"
}

// Return an SPAN element to decorate a given path (string)
function getSpanForPath(path) {
	var parts = path.split(/[\/\\]/)
	
	var innerSpan = createNode("span", parts.pop())
	innerSpan.style.fontSize = "larger"
	
	var outerSpan = createNode("span", parts.join("/")+"/")
	outerSpan.style.fontSize = "smaller"
	outerSpan.style.fontStyle = "italic"
	outerSpan.appendChild(innerSpan)
	
	return outerSpan
}

// Return a human readable notation for the given number of bytes
function bytes2str(bytes) {
	var ki, Mi, Gi
	ki = bytes/1024
	Mi = ki/1024
	Gi = Mi/1024
	if (bytes < 1e3)
		return bytes+" B"
	if (ki < 1e3)
		return ki.toPrecision(3)+" kiB"
	if (Mi < 1e3)
		return Mi.toPrecision(3)+" MiB"
	return Gi.toPrecision(3)+" GiB"
}

// Create and return a new HTML element
// Has three uses:
// create(textNodeContent)
// create(tagName, textContent)
// create(tagName, tagClass, textContent)
function createNode(a, b, c) {
	if (arguments.length == 1)
		return document.createTextNode(a)
	var el = document.createElement(a)
	if (arguments.length == 2)
		el.textContent = b
	else {
		el.className = b
		el.textContent = c
	}
	return el
}

// Convert the given Date object to a relative, human-readable string
function date2str(date) {
	var delta = Date.now()-date.getTime()
	
	if (delta < 2*60*1e3)
		return "just now"
	if (delta < 2*60*60*1e3)
		return Math.round(delta/(60*1e3))+" minutes ago"
	if (delta < 2*24*60*60*1e3)
		return Math.round(delta/(60*60*1e3))+" hours ago"
	if (delta < 2*30.4375*24*60*60*1e3)
		return Math.round(delta/(24*60*60*1e3))+" days ago"
	if (delta < 2*365.25*24*60*60*1e3)
		return Math.round(delta/(30.4375*24*60*60*1e3))+" months ago"
	return Math.round(delta/(365.25*24*60*60*1e3))+" years ago"
}
