// Control the files explorer

"use strict"

var FilesExplorer = {}

// Start the FilesExplorer
// pathEl is the DOM element to display the current path
// stageEl is the DOM element to display the file list
FilesExplorer.init = function (pathEl, stageEl) {
	FilesExplorer._pathEl = pathEl
	FilesExplorer._stageEl = stageEl
	FilesExplorer._updatePathEl()
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
		
	span = document.createElement("span")
	span.className = "button"
	span.textContent = "/"
	span.onclick = FilesExplorer._getPathOnClick(path.length)
	pathEl.appendChild(span)
	
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

// Update the stage DOM element to reflect _path and _tree
FilesExplorer._updateStageEl = function () {
	// Get the folder
	var i
	var path = FilesExplorer._path
	var folder = FilesExplorer._tree
	for (i=0; i<path.length; i++)
		folder = folder.items[path[i]]
	
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
		div.onclick = FilesExplorer._getFolderOnClick(folderName, "items" in item)
		stageEl.appendChild(div)
	})
	
	files.forEach(function (fileName) {
		var item = folder.items[fileName]
		var div = FilesExplorer._createDivForItem(FilesExplorer._getIconClass(fileName), item, fileName)
		div.onclick = FilesExplorer._getFileOnClick()
		stageEl.appendChild(div)
	})
}

FilesExplorer._createDivForItem = function (iconClass, item, itemName) {
	var div = document.createElement("div")
	
	div.className = "item button"
	div.classList.add(iconClass)
	div.classList.add(item.uploader ? "icon-sync" : "icon-ok")
	if (!item.watcher) div.classList.add("deleted")
	
	var span = document.createElement("span")
	span.textContent = itemName
	div.appendChild(span)
	
	return div
}

FilesExplorer._getFolderOnClick = function (itemName) {
	return function () {
		FilesExplorer._path.push(itemName)
		FilesExplorer._updatePathEl()
		FilesExplorer._updateStageEl()
	}
}

FilesExplorer._getFileOnClick = function () {
	return function () {
		
	}
}

// Get the best icon based on the file name
FilesExplorer._getIconClass = function (fileName) {
	var pos, ext
	
	var exts = {
		compressed: ["zip", "rar"],
		css: ["css"],
		developer: ["js", "php"],
		excel: ["xls", "xlsx"],
		fireworks: [],
		flash: ["fla"],
		html: ["htm", "html"],
		illustrator: ["ai"],
		image: ["png", "gif", "jpg", "jpeg", "ico"],
		keynote: [],
		movie: ["mp4", "rmvb"],
		music: ["mp3", "wav"],
		numbers: [],
		pages: [],
		pdf: ["pdf"],
		photoshop: [],
		powerpoint: ["ppt", "pptx", "pps", "ppsx"],
		text: ["txt", "md", "json", "sql"],
		word: ["doc", "docx"]
	}
	
	pos = fileName.lastIndexOf(".")
	ext = pos==-1 ? "" : fileName.substr(pos+1).toLowerCase()
	
	var key
	for (key in exts)
		if (exts[key].indexOf(ext) != -1)
			return "icon-"+key
	
	return "icon-file"
}
