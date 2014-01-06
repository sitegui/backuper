// Represent a Tree that can be serialized into JSON and back
// Each item of the tree has a name
// Each leaf has a name and can be associated with an string, number, array or bool value

"use strict"

var path = require("path")

// Create a new tree
// If savedData is not given, the tree is created empty
// Otherwise, this should be the JSON-parsed data of the tree
function Tree(savedData) {
	var item
	this.items = Object.create(null)
	if (savedData) {
		for (item in savedData)
			if (item.charAt(0) == "/")
				// Folder
				this.items[item.substr(1)] = new Tree(savedData[item])
			else
				// File
				this.items[item] = savedData[item]
		this.clear()
	}
}

module.exports = Tree

// Return the JSON object representation of the whole tree
Tree.prototype.toJSON = function () {
	var itemName, item, obj = {}
	for (itemName in this.items) {
		item = this.items[itemName]
		if (item instanceof Tree)
			obj["/"+itemName] = item.toJSON()
		else
			obj[itemName] = item
	}
	return obj
}

// Search and return the folder inside this tree (given it's path, as string)
// If the folder doesn't exist, it's created
Tree.prototype.getFolder = function (folderPath) {
	var folder = this
	folderPath.split(path.sep).forEach(function (item) {
		if (!(item in folder.items))
			folder.items[item] = new Tree
		folder = folder.items[item]
	})
	return folder
}

// Return an Array of all item names directly inside this tree
Tree.prototype.getItems = function () {
	return Object.keys(this.items)
}

// Return an Array of all files that are inside the tree
Tree.prototype.getAllFiles = function () {
	var files = []
	
	var aux = function (items, prefix) {
		var itemName, item
		for (itemName in items) {
			item = items[itemName]
			if (item instanceof Tree)
				aux(item.items, prefix+itemName+path.sep)
			else
				files.push(prefix+itemName)
		}
	}
	
	aux(this.items, "")
	return files
}

// Return if the given item is a file child of this tree
Tree.prototype.isFile = function (item) {
	return item in this.items && !(this.items[item] instanceof Tree)
}

// Remove the given item from the child list
Tree.prototype.removeItem = function (item) {
	delete this.items[item]
}

// Return the info associated with the given child
// undefined is returned if there is no such file
Tree.prototype.getFileInfo = function (file) {
	return this.items[file]
}

// Set the info associated with the given file
// If there is currently no file with the given name, one is created
Tree.prototype.setFileInfo  = function (file, info) {
	this.items[file] = info
}

// Check whether the given tree is empty (without files)
Tree.prototype.isEmpty = function () {
	var itemName, item
	for (itemName in this.items) {
		item = this.items[itemName]
		if (item instanceof Tree) {
			if (!item.isEmpty())
				return false
		} else
			return false
	}
	return true
}

// Remove empty subtrees
Tree.prototype.clear = function () {
	var that = this
	this.getItems().forEach(function (itemName) {
		var item = that.items[itemName]
		if (item instanceof Tree) {
			item.clear()
			if (item.isEmpty())
				delete that.items[itemName]
		}
	})
}

// Search for any file in the whole tree
// If none is found, return null
// Return an object with keys "fullPath", "folder", "fileName" otherwise
Tree.prototype.getAnyFile = function () {
	var itemName, item, sub
	
	for (itemName in this.items) {
		item = this.items[itemName]
		if (!(item instanceof Tree))
			// A file!
			return {fullPath: itemName, folder: this, fileName: itemName}
		if ((sub = item.getAnyFile())) {
			sub.fullPath = itemName+path.sep+sub.fullPath
			return sub
		}
	}
	
	return null
}
