/*global aP, _port, FilesExplorer, Window*/

"use strict"

var E_SERVER_IS_DOWN = aP.registerException(100)
var CC_GET_UPLOADER_STATUS = aP.registerClientCall(100, "", "busuf")
var CC_GET_TREE = aP.registerClientCall(101, "", "s")
var CC_GET_WATCHED_FOLDERS = aP.registerClientCall(102, "", "(s)")
var CC_ADD_WATCH_FOLDER = aP.registerClientCall(103, "s", "(s)")
var CC_REMOVE_WATCH_FOLDER = aP.registerClientCall(104, "s", "(s)")
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
	_conn.oncall = function (type, data, answer) {
		if (type == SC_UPLOADER_PROGRESS) {
			updateUploaderStatus(data[0], data[1], data[2], data[3], data[4])
			answer()
		}
	}
}
_conn.onclose = function () {
	console.log("closed")
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
	var el = get("upload")
	var status
	if (!file)
		el.textContent = "Idle"
	else {
		status = connected ? Math.round(100*progress)+"%" : "paused"
		el.textContent = "Uploading "+file+" ("+status+")"
	}
}

// Update the list of watched folders
function updateWatchedList(folders) {
	var el = get("watch-list")
	el.innerHTML = ""
	
	// Append the folder names list
	folders.forEach(function (folder) {
		var li = document.createElement("li")
		li.appendChild(document.createTextNode(folder+" - "))
		var span = document.createElement("span")
		span.textContent = "Remove"
		span.onclick = function () {
			_conn.sendCall(CC_REMOVE_WATCH_FOLDER, folder, function (folders) {
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
