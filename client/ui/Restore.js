// Control the UI for the restore process

/*global Window, createNode, FolderPicker, CC_CREATE_DOWNLOAD_TASK, _conn, aP*/

"use strict"

var Restore = {}

Restore.restoreFolder = function (tree) {
	// Grab some statistics about the files in the tree
	// Create a tree for the files to download
	var filesCount = 0
	var totalSize = 0
	var maxLength = 0
	var finalTree = Object.create(null)
	var walkTree = function (tree, path, finalTree) {
		var itemName, item, finalSubTree
		for (itemName in tree.items) {
			item = tree.items[itemName]
			if ("items" in item) {
				finalSubTree = Object.create(null)
				finalTree["/"+itemName] = finalSubTree
				if (!walkTree(item, path+itemName+"/", finalSubTree))
					return false
			} else if (!item.server)
				return false // Return false on error
			else if (item.server.length) {
				filesCount++
				totalSize += item.server[0].size
				finalTree[itemName] = item.server[0].id
				maxLength = Math.max(maxLength, path.length+itemName.length)
			}
		}
		return true
	}
	if (!walkTree(tree, "", finalTree))
		return Window.open("Restore folder").appendChild(createNode("p", "Error: could not connect with the server"))
	
	Restore._pickFolder(filesCount, totalSize, maxLength, finalTree)
}

/*
Internals
*/

Restore._totalSize = 0 // total restoration size
Restore._maxLength = 0 // the max path length
Restore._filesCount = 0 // number of files to restore
Restore._tree = null // the tree if the backed up files id

// Let the user pick a destination folder
Restore._pickFolder = function (filesCount, totalSize, maxLength, finalTree) {
	FolderPicker.pick("Choose a folder to restore the files to", function (destination) {
		var div, p, back, goOn
		if (destination) {
			if (destination.length+maxLength+1 > 255) {
				// Show the length warning
				div = Window.open("Restore warning")
				div.appendChild(createNode("p", "Warning: some files will not be restored because their absolute path is longer than 255 characters"))
				div.appendChild(p = createNode("p", ""))
				p.appendChild(back = createNode("span", "button", "Choose another destination"))
				p.appendChild(goOn = createNode("span", "button", "Continue and ignore these files"))
				back.onclick = function () {
					Restore._pickFolder(filesCount, totalSize, maxLength, finalTree)
				}
				goOn.onclick = function () {
					Restore._commit(filesCount, totalSize, maxLength, finalTree, destination)
				}
			} else
				// Continue
				Restore._commit(filesCount, totalSize, maxLength, finalTree, destination)
		}
	})
}

// Commit the job to the node client and show a status UI
Restore._commit = function (filesCount, totalSize, maxLength, finalTree, destination) {
	// TODO
	var data = new aP.Data().addString(JSON.stringify(finalTree)).addString(destination)
	_conn.sendCall(CC_CREATE_DOWNLOAD_TASK, data)
	//Window.open("Restoring").appendChild(createNode("p", JSON.stringify(finalTree)))
}
