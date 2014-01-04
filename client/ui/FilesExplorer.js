// Control the files explorer

/*global Window, bytes2str, get, Restore, createNode, date2str*/

"use strict"

var FilesExplorer = {}

// Start the FilesExplorer
// pathEl is the DOM element to display the current path
// stageEl is the DOM element to display the file list
FilesExplorer.init = function (pathEl, stageEl) {
	FilesExplorer._pathEl = pathEl
	FilesExplorer._stageEl = stageEl
	FilesExplorer._updatePathEl()
	get("restore-folder").onclick = function () {
		Restore.restoreFolder(FilesExplorer._getCurrentTree())
	}
	stageEl.textContent = "Loading..."
}

// Set the new tree
FilesExplorer.setTree = function (tree) {
	FilesExplorer._tree = tree
	FilesExplorer._updateStageEl()
}

/*
Internals
*/

FilesExplorer._tree = null
FilesExplorer._pathEl = null
FilesExplorer._stageEl = null
FilesExplorer._path = [] // the current path beeing shown

// Update the path DOM element to reflect FilesExplorer._path
FilesExplorer._updatePathEl = function () {
	var i, span
	var path = FilesExplorer._path
	var pathEl = FilesExplorer._pathEl
	pathEl.innerHTML = ""
		
	span = createNode("span", "button", "/")
	span.onclick = FilesExplorer._getPathOnClick(path.length)
	pathEl.appendChild(span)
	
	for (i=0; i<path.length; i++) {
		if (i) {
			span = createNode("span", "/")
			pathEl.appendChild(span)
		}
		
		span = createNode("span", path[i])
		if (i != path.length-1) {
			span.className = "button"
			span.onclick = FilesExplorer._getPathOnClick(path.length-i-1)
		}
		pathEl.appendChild(span)
	}
}

FilesExplorer._getPathOnClick = function (n) {
	return function () {
		FilesExplorer._path.splice(-n, n)
		FilesExplorer._updatePathEl()
		FilesExplorer._updateStageEl()
	}
}

// Return the current tree, based on FilesExplorer._path
FilesExplorer._getCurrentTree = function () {
	var path = FilesExplorer._path, i
	var folder = FilesExplorer._tree
	for (i=0; i<path.length; i++)
		folder = folder.items[path[i]]
	return folder
}

// Update the stage DOM element to reflect _path and _tree
FilesExplorer._updateStageEl = function () {
	// Get the folder
	var folder = FilesExplorer._getCurrentTree()
	
	var stageEl = FilesExplorer._stageEl
	var itemName
	stageEl.innerHTML = ""
	
	// Put folders and files apart
	var folders = []
	var files = []
	for (itemName in folder.items)
		if ("items" in folder.items[itemName])
			folders.push(itemName)
		else
			files.push(itemName)
	folders.sort()
	files.sort()
	
	folders.forEach(function (folderName) {
		var item = folder.items[folderName]
		var div = FilesExplorer._createDivForItem("icon-folder", item, folderName)
		div.onclick = FilesExplorer._getFolderOnClick(folderName)
		stageEl.appendChild(div)
	})
	
	files.forEach(function (fileName) {
		var item = folder.items[fileName]
		var div = FilesExplorer._createDivForItem(FilesExplorer._getIconClass(fileName), item, fileName)
		div.onclick = FilesExplorer._getFileOnClick(fileName, item)
		stageEl.appendChild(div)
	})
}

FilesExplorer._createDivForItem = function (iconClass, item, itemName) {
	var div = createNode("div", "item button", "")
	
	div.classList.add(iconClass)
	div.classList.add(item.uploader ? "icon-sync" : "icon-ok")
	if (!item.watcher) div.classList.add("deleted")
	
	div.appendChild(createNode("span", itemName))
	
	return div
}

FilesExplorer._getFolderOnClick = function (folderName) {
	return function () {
		FilesExplorer._path.push(folderName)
		FilesExplorer._updatePathEl()
		FilesExplorer._updateStageEl()
		window.scrollTo(0, 0)
	}
}

FilesExplorer._getFileOnClick = function (fileName, item) {
	return function () {
		var info
		
		if (!item.server)
			info = createNode("p", "Could not connect to the server to grab more information about this file")
		else if (!item.server.length)
			info = createNode("p", "This file is not backed up yet")
		else {
			info = createNode("ul", "")
			item.server.forEach(function (each) {
				info.appendChild(createNode("li", FilesExplorer._decodeDate(each.mtime)+" - "+bytes2str(each.size)))
			})
		}
		
		Window.open(fileName).appendChild(info)
	}
}

// Get the best icon based on the file name
FilesExplorer._getIconClass = function (fileName) {
	var pos, ext
	
	var exts = {
		compressed: ["zip", "rar"],
		css: ["css"],
		developer: ["js", "php"],
		excel: ["xls", "xlsx", "xlt", "xltx"],
		fireworks: [],
		flash: ["fla", "swf"],
		html: ["htm", "html"],
		illustrator: ["ai"],
		image: ["png", "gif", "jpg", "jpeg", "ico"],
		keynote: [],
		movie: ["mp4", "rmvb", "wmv", "mpg", "mpeg", "asf"],
		music: ["mp3", "wav"],
		numbers: [],
		pages: [],
		pdf: ["pdf"],
		photoshop: [],
		powerpoint: ["ppt", "pptx", "pps", "ppsx"],
		text: ["txt", "md", "json", "sql"],
		word: ["doc", "docx", "dot", "dotx"]
	}
	
	pos = fileName.lastIndexOf(".")
	ext = pos==-1 ? "" : fileName.substr(pos+1).toLowerCase()
	
	var key
	for (key in exts)
		if (exts[key].indexOf(ext) != -1)
			return "icon-"+key
	
	return "icon-file"
}

// Convert the number to a relative, human-readable date (string)
FilesExplorer._decodeDate = function (time) {
	var d, m, y, h, i, date = new Date
	
	i = time%60
	time = Math.floor(time/60)
	h = time%24
	time = Math.floor(time/24)
	d = time%31
	time = Math.floor(time/31)
	m = time%12
	time = Math.floor(time/12)
	y = time
	
	date.setUTCFullYear(1990+y, m, d)
	date.setUTCHours(h, i, 0, 0)
	
	return date2str(date)
}
