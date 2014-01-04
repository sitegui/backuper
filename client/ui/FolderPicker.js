// Use the Window module to present a UI to pick a folder in the file system

/*global Window, _conn, CC_GET_FOLDERS_IN_DIR, CC_GET_DISK_UNITS*/

"use strict"

var FolderPicker = {}

// Show the interface (title: string will be window title)
// callback(folder: string) will be called at the end
// folder will be null if the user canceled the process
FolderPicker.pick = function (title, callback) {
	var mainDiv = Window.open(title, FolderPicker._onclose)
	var pathEl = document.createElement("p")
	var stageEl = document.createElement("div")
	var optionsEl = document.createElement("p")
	var doneButton = document.createElement("span")
	var showUnitsList = document.createElement("span")
	optionsEl.appendChild(doneButton)
	optionsEl.appendChild(document.createTextNode(" - "))
	optionsEl.appendChild(showUnitsList)
	mainDiv.appendChild(optionsEl)
	mainDiv.appendChild(pathEl)
	mainDiv.appendChild(stageEl)
	
	pathEl.className = "path"
	stageEl.className = "items-stage"
	doneButton.className = "button"
	doneButton.textContent = "Select current"
	doneButton.onclick = function () {
		FolderPicker._done = true
		FolderPicker._callback(FolderPicker._getPathAsString())
		Window.close()
	}
	showUnitsList.className = "button"
	showUnitsList.textContent = "Show units list"
	showUnitsList.onclick = function () {
		FolderPicker._relative = false
		FolderPicker._path = []
		FolderPicker._updatePathEl()
		FolderPicker._loadSubDirs()
	}
	
	FolderPicker._callback = callback
	FolderPicker._path = []
	FolderPicker._pathEl = pathEl
	FolderPicker._stageEl = stageEl
	FolderPicker._done = false
	FolderPicker._relative = true
	
	FolderPicker._updatePathEl()
	FolderPicker._loadSubDirs()
}

/*
Internals
*/

FolderPicker._callback = null
FolderPicker._relative = true
FolderPicker._path = []
FolderPicker._pathEl = null
FolderPicker._stageEl = null
FolderPicker._done = true

FolderPicker._onclose = function () {
	if (!FolderPicker._done) {
		FolderPicker._done = true
		FolderPicker._callback(null)
	}
}

// Get the server to scan the current dir for subdirs
FolderPicker._loadSubDirs = function () {
	FolderPicker._stageEl.textContent = "Loading..."
	if (!FolderPicker._relative && !FolderPicker._path.length)
		_conn.sendCall(CC_GET_DISK_UNITS, null, function (units) {
			FolderPicker._stageEl.textContent = ""
			units.forEach(function (unit) {
				var div = document.createElement("div")
				div.className = "item button icon-folder"
				
				var span = document.createElement("span")
				span.textContent = unit
				div.appendChild(span)
				div.onclick = FolderPicker._getFolderOnClick(unit)
				FolderPicker._stageEl.appendChild(div)
			})
			FolderPicker._stageEl.parentNode.scrollTop = 0
		})
	else
		_conn.sendCall(CC_GET_FOLDERS_IN_DIR, FolderPicker._getPathAsString(), function (folderNames) {
			FolderPicker._stageEl.textContent = ""
			folderNames.forEach(function (folderName) {
				var div = document.createElement("div")
				div.className = "item button icon-folder"
				
				var span = document.createElement("span")
				span.textContent = folderName
				div.appendChild(span)
				div.onclick = FolderPicker._getFolderOnClick(folderName)
				FolderPicker._stageEl.appendChild(div)
			})
			FolderPicker._stageEl.parentNode.scrollTop = 0
		})
}

FolderPicker._getFolderOnClick = function (folderName) {
	return function () {
		FolderPicker._path.push(folderName)
		FolderPicker._updatePathEl()
		FolderPicker._loadSubDirs()
	}
}

// Update the path DOM element to reflect the current path
FolderPicker._updatePathEl = function () {
	var i, span
	var path = FolderPicker._path
	var pathEl = FolderPicker._pathEl
	pathEl.innerHTML = ""
	
	if (FolderPicker._relative) {
		span = document.createElement("span")
		span.textContent = "/"
		span.className = "button"
		span.onclick = FolderPicker._getPathOnClick(path.length)
		pathEl.appendChild(span)
	}
	
	for (i=0; i<path.length; i++) {
		if (i) {
			span = document.createElement("span")
			span.textContent = "/"
			pathEl.appendChild(span)
		}
		
		span = document.createElement("span")
		span.textContent = path[i]
		if (i != path.length-1) {
			span.className = "button"
			span.onclick = FolderPicker._getPathOnClick(path.length-i-1)
		}
		pathEl.appendChild(span)
	}
}

FolderPicker._getPathOnClick = function (n) {
	return function () {
		FolderPicker._path.splice(-n, n)
		FolderPicker._updatePathEl()
		FolderPicker._loadSubDirs()
	}
}

FolderPicker._getPathAsString = function () {
	if (FolderPicker._relative)
		return "/"+FolderPicker._path.join("/")
	return FolderPicker._path.join("/")
}
