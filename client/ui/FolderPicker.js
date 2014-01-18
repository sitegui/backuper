// Use the Window module to present a UI to pick a folder in the file system

/*global Window, _conn, createNode*/

"use strict"

var FolderPicker = {}

// Show the interface (title: string will be window title)
// callback(folder: string) will be called at the end
// folder will be null if the user canceled the process
FolderPicker.pick = function (title, callback) {
	var done = false
	var mainDiv = Window.open(title, function () {
		if (!done)
			callback(null)
	})
	var pathEl = createNode("p", "path", "")
	var stageEl = createNode("div", "items-stage", "")
	var optionsEl = createNode("p", "")
	var doneButton = createNode("span", "button", "Select current")
	var showUnitsList = createNode("span", "button", "Show units list")
	optionsEl.appendChild(doneButton)
	optionsEl.appendChild(document.createTextNode(" - "))
	optionsEl.appendChild(showUnitsList)
	mainDiv.appendChild(optionsEl)
	mainDiv.appendChild(pathEl)
	mainDiv.appendChild(stageEl)
	
	doneButton.onclick = function () {
		done = true
		Window.close()
		callback(FolderPicker._getPathAsString())
	}
	showUnitsList.onclick = function () {
		FolderPicker._relative = false
		FolderPicker._path = []
		FolderPicker._updatePathEl()
		FolderPicker._loadSubDirs()
	}
	
	FolderPicker._path = []
	FolderPicker._pathEl = pathEl
	FolderPicker._stageEl = stageEl
	FolderPicker._relative = true
	
	FolderPicker._updatePathEl()
	FolderPicker._loadSubDirs()
}

/*
Internals
*/

FolderPicker._relative = true
FolderPicker._path = []
FolderPicker._pathEl = null
FolderPicker._stageEl = null

// Get the server to scan the current dir for subdirs
FolderPicker._loadSubDirs = function () {
	FolderPicker._stageEl.textContent = "Loading..."
	if (!FolderPicker._relative && !FolderPicker._path.length)
		_conn.call("getDiskUnits", null, function (err, result) {
			FolderPicker._stageEl.textContent = ""
			result.units.forEach(function (unit) {
				var div = createNode("div", "item button icon-folder", "")
				
				div.appendChild(createNode("span", unit))
				div.onclick = FolderPicker._getFolderOnClick(unit)
				FolderPicker._stageEl.appendChild(div)
			})
			FolderPicker._stageEl.parentNode.scrollTop = 0
		})
	else
		_conn.call("getFoldersInDir", {dir: FolderPicker._getPathAsString()}, function (err, result) {
			FolderPicker._stageEl.textContent = ""
			result.folders.forEach(function (folderName) {
				var div = createNode("div", "item button icon-folder", "")
				
				div.appendChild(createNode("span", folderName))
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
		span = createNode("span", "button", "/")
		span.onclick = FolderPicker._getPathOnClick(path.length)
		pathEl.appendChild(span)
	}
	
	for (i=0; i<path.length; i++) {
		if (i)
			pathEl.appendChild(createNode("span", "/"))
		
		span = createNode("span", path[i])
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
