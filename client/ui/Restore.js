// Control the UI for the restore process

/*global Window, createNode, FolderPicker, _conn*/

"use strict"

var Restore = {}

// Initiate this module with the given element to output status info
Restore.init = function (statusEl) {
	Restore._statusEl = statusEl
	
	// Get all tasks info first
	_conn.call("getRestoreProgress", null, function (err, result) {
		var tasks, display = "none"
		if (result) {
			tasks = result.tasks
			tasks.forEach(function (task) {
				if (task.numFiles) {
					// Create the status tag
					statusEl.appendChild(task.el = createNode("p", ""))
					Restore._updateTaskStatusEl(task)
					Restore._tasks[task.id] = task
					display = ""
				}
			})
			statusEl.style.display = display
		}
	})
}

// Update the progress for a given task
Restore.setProgress = function (taskId, numFiles) {
	var task = Restore._tasks[taskId]
	if (!task) return
	task.numFiles = numFiles
	Restore._updateTaskStatusEl(task)
}

// Add a new error to the given task
Restore.setError = function (taskId, error) {
	var task = Restore._tasks[taskId]
	if (!task) return
	task.errors.push(error)
	Restore._updateTaskStatusEl(task)
	
	if (Restore._showingErrors && Restore._showingErrors.taskId === taskId)
		Restore._showingErrors.el.appendChild(createNode("li", error))
}

Restore.restoreFolder = function (tree) {
	// Grab some statistics about the files in the tree
	// Create a tree for the files to download
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
				finalTree[itemName] = item.server[0].id
				maxLength = Math.max(maxLength, path.length+itemName.length)
			}
		}
		return true
	}
	if (!walkTree(tree, "", finalTree))
		return Window.open("Restore folder").appendChild(createNode("p", "Error: could not connect with the server"))
	
	Restore._pickFolder(maxLength, finalTree)
}

// Restore a single file version
Restore.restoreVersion = function (fileName, uploadId) {
	var tree = Object.create(null)
	tree[fileName] = uploadId
	Restore._pickFolder(fileName.length, tree)
}

/*
Internals
*/

Restore._statusEl = null
Restore._tasks = {} // the registered tasks, indexed by their id
Restore._showingErrors = null // null if not currently showing any error list. Otherwise is an object with the keys "taskId" and "el"

// Let the user pick a destination folder
Restore._pickFolder = function (maxLength, finalTree) {
	FolderPicker.pick("Choose a folder to restore the files to", function (destination) {
		var div, p, back, goOn
		if (destination) {
			if (destination.length+maxLength+1 > 255) {
				// Show the length warning
				div = Window.open("Restore warning")
				div.appendChild(createNode("p", "Warning: some files will not be restored because their absolute path is longer than 255 characters"))
				div.appendChild(p = createNode("p", ""))
				p.appendChild(back = createNode("span", "button", "Choose another destination"))
				p.appendChild(createNode(" - "))
				p.appendChild(goOn = createNode("span", "button", "Continue and ignore these files"))
				back.onclick = function () {
					Restore._pickFolder(maxLength, finalTree)
				}
				goOn.onclick = function () {
					Window.close()
					Restore._commit(finalTree, destination)
				}
			} else
				// Continue
				Restore._commit(finalTree, destination)
		}
	})
}

// Commit the job to the node client and show a status UI
Restore._commit = function (finalTree, destination) {
	var data = {files: JSON.stringify(finalTree), destination: destination}
	_conn.call("createDownloadTask", data, function (err, result) {
		if (err) return
		var task = {
			id: result.id,
			destination: destination,
			numFiles: result.numFiles,
			errors: []
		}
		
		// Create the task html element
		Restore._statusEl.appendChild(task.el = createNode("p", ""))
		Restore._statusEl.style.display = ""
		Restore._updateTaskStatusEl(task)
		
		// Store it
		Restore._tasks[result.id] = task
	})
}

// Fill the given <p> element with info about the task status
// task is the task object (as returned by node)
Restore._updateTaskStatusEl = function (task) {
	var btErrors, n, btCancel
	
	// Basic label
	if (task.numFiles === 0)
		task.el.textContent = "Done"
	else if (task.numFiles === 1)
		task.el.textContent = "1 file"
	else
		task.el.textContent = task.numFiles+" files"
	
	// Errors display
	n = task.errors.length
	if (n) {
		task.el.textContent += " - "
		btErrors = createNode("span", "button", n===1 ? "1 error" : n+" errors")
		btErrors.onclick = function () {
			Restore._showErrors(task)
		}
		task.el.appendChild(btErrors)
	}
	
	// Cancel button
	if (task.numFiles) {
		task.el.appendChild(createNode(" - "))
		btCancel = createNode("span", "button", "Cancel")
		btCancel.onclick = function () {
			Restore._cancelTask(task)
		}
		task.el.appendChild(btCancel)
	}
}

// Show the errors for a given restore task
Restore._showErrors = function (task) {
	var ul = createNode("ul", "")
	Window.open("Errors", function () {
		Restore._showingErrors = null
	}).appendChild(ul)
	task.errors.forEach(function (error) {
		ul.appendChild(createNode("li", error))
	})
	Restore._showingErrors = {taskId: task.id, el: ul}
}

// Cancel a given task
Restore._cancelTask = function (task) {
	_conn.call("cancelRestoreTask", {id: task.id})
	
	task.el.parentNode.removeChild(task.el)
	delete Restore._tasks[task.id]
	var empty = true, temp
	for (temp in Restore._tasks) {
		empty = false
		break
	}
	if (empty)
		Restore._statusEl.style.display = "none"
}
