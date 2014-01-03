/*global aP, _port, FilesExplorer, Window*/

"use strict"

var E_SERVER_IS_DOWN = aP.registerException(100)
var CC_GET_UPLOADER_STATUS = aP.registerClientCall(100, "", "busuf")
var CC_GET_TREE = aP.registerClientCall(101, "", "s")
var CC_GET_WATCHED_FOLDERS = aP.registerClientCall(102, "", "(su)")
var CC_ADD_WATCH_FOLDER = aP.registerClientCall(103, "s", "(su)")
var CC_REMOVE_WATCH_FOLDER = aP.registerClientCall(104, "s", "(su)")
var CC_GET_QUOTA_USAGE = aP.registerClientCall(105, "", "uuu", [E_SERVER_IS_DOWN])
var SC_UPLOADER_PROGRESS = aP.registerServerCall(100, "busuf")

var _conn = new aP("ws://localhost:"+_port)
_conn.onopen = function () {
	_conn.sendCall(CC_GET_UPLOADER_STATUS, null, function (data) {
		updateUploaderStatus(data[0], data[1], data[2], data[3], data[4])
	})
	_conn.sendCall(CC_GET_TREE, null, function (str) {
		FilesExplorer.setTree(JSON.parse(str))
	})
	_conn.sendCall(CC_GET_WATCHED_FOLDERS, null, function (folders) {
		updateWatchedList(folders)
	})
	_conn.sendCall(CC_GET_QUOTA_USAGE, null, function (info) {
		updateQuota(info)
	})
	_conn.oncall = function (type, data, answer) {
		if (type == SC_UPLOADER_PROGRESS) {
			updateUploaderStatus(data[0], data[1], data[2], data[3], data[4])
			answer()
		}
	}
}
_conn.onclose = function () {
	Window.open("Connection error").textContent = "Please refresh the page to try again"
}

window.onload = function () {
	FilesExplorer.init(get("files-path"), get("files-stage"))
	Window.init()
}

function get(id) {
	return document.getElementById(id)
}

// Update the info shown in the interface
function updateUploaderStatus(connected, queueLength, file, size, progress) {
	var queueEl = get("upload-queue")
	if (queueLength)
		queueEl.textContent = queueLength+" file"+(queueLength==1 ? "" : "s")+" waiting for upload"
	else
		queueEl.textContent = "No more files in the upload queue"
	
	var progressEl = get("upload-progress")
	if (!file)
		progressEl.textContent = "No current upload"
	else {
		progressEl.textContent = "Uploading "
		progressEl.appendChild(getSpanForPath(file))
		progressEl.appendChild(document.createTextNode(" ("+connected ? Math.floor(100*progress) : "paused"+")"))
	}
}

// Update the quota display
// info is an Array [uint total, uint free, uint softUse]
function updateQuota(info) {
	var el = get("upload-quota")
	el.textContent = bytes2str(info[1])+" free ("+bytes2str(info[0])+" total)"
}

// Update the list of watched folders
function updateWatchedList(folders) {
	var el = get("watch-list")
	el.innerHTML = ""
	
	// Append the folder names list
	folders.forEach(function (folder) {
		var li = document.createElement("li")
		li.appendChild(getSpanForPath(folder[0]))
		li.appendChild(document.createTextNode(" ("+folder[1]+" files) - "))
		var span = document.createElement("span")
		span.textContent = "Remove"
		span.onclick = function () {
			_conn.sendCall(CC_REMOVE_WATCH_FOLDER, folder[0], function (folders) {
				updateWatchedList(folders)
			})
			span.onclick = null
		}
		span.className = "button"
		li.appendChild(span)
		
		el.appendChild(li)
	})
	
	// Put the add button
	var li = document.createElement("li")
	var span = document.createElement("span")
	span.textContent = "Add"
	span.className = "button"
	span.onclick = function () {
		var folder = prompt("Input the folder name")
		if (folder)
			_conn.sendCall(CC_ADD_WATCH_FOLDER, folder, function (folders) {
				updateWatchedList(folders)
			})
	}
	li.appendChild(span)
	el.appendChild(li)
}

// Return an SPAN element to decorate a given path (string)
function getSpanForPath(path) {
	var parts = path.split(/[\/\\]/)
	
	var innerSpan = document.createElement("span")
	innerSpan.style.fontSize = "larger"
	innerSpan.style.color = "black"
	innerSpan.textContent = parts.pop()
	
	var outerSpan = document.createElement("span")
	outerSpan.style.fontSize = "smaller"
	outerSpan.style.color = "gray"
	outerSpan.textContent = parts.join("/")+"/"
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
