"use strict"

window.onload = function () {
	setInterval(loadFileWatcherStatus, 30e3)
	setInterval(loadUploaderStatus, 15e3)
	loadFileWatcherStatus()
	loadUploaderStatus()
}

function loadFileWatcherStatus() {
	loadJSON("status/fileWatcher", function (status) {
		var list = document.getElementById("watcher-queue")
		list.innerHTML = ""
		var folder, listItem
		for (folder in status.queue) {
			listItem = document.createElement("li")
			listItem.appendChild(getSpanForPath(folder))
			listItem.appendChild(document.createTextNode(": "+status.queue[folder].length+" folders on the queue"))
			list.appendChild(listItem)
		}
	})
}

function loadUploaderStatus() {
	loadJSON("status/uploader", function (status) {
		var current = document.getElementById("current-upload")
		var progress
		if (!status.uploading)
			current.textContent = "Nothing"
		else {
			current.innerHTML = ""
			current.appendChild(getSpanForPath(status.uploading.file))
			progress = Math.round(100*1024*1024*status.uploading.sentChunks/status.uploading.size)
			current.appendChild(document.createTextNode(" ("+progress+"%)"))
		}
		
		document.getElementById("upload-queue").textContent = getTreeCount(status.tree)
	})
}

function loadJSON(url, callback) {
	var ajax = new XMLHttpRequest
	ajax.open("GET", url)
	ajax.send()
	if (callback)
		ajax.onload = function () {
			callback(JSON.parse(ajax.responseText))
		}
}

// Return an span element with the given path string
function getSpanForPath(path) {
	var last, sep, span, innerSpan
	
	sep = path.indexOf("/")==-1 ? "\\" : "/"
	path = path.split(sep)
	last = path.pop()
	path = path.join(sep)+sep
	
	span = document.createElement("span")
	span.style.fontSize = "smaller"
	span.style.color = "gray"
	span.textContent = path
	
	innerSpan = document.createElement("span")
	innerSpan.style.color = "black"
	innerSpan.style.fontSize = "larger"
	innerSpan.textContent = last
	
	span.appendChild(innerSpan)
	
	return span
}

function getTreeCount(tree) {
	var key, count = 0
	for (key in tree) {
		if (key[0] == "/")
			count += getTreeCount(tree[key])
		else
			count++
	}
	return count
}
