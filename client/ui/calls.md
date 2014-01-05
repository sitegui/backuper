# Exceptions

## 100: SERVER_IS_DOWN()
Sent when the server hasn't responded

# Client calls

## 100: getUploaderStatus() -> (bool connected, uint queueLength, string file, uint size, float progress)
Return the current upload status
If idle, file will be an empty string
Whenever this changes, the server will send uploaderProgress()
progress is a value between 0 and 1

## 101: getTree() -> (string tree)
Return the tree of all know files (JSON-encoded)
Return empty string if the server is down
Leaf items have these keys:
	{
	watcher: bool, // whether the watcher module knows this file
	uploader: bool, // whether the uploader module scheduled an update for this file
	server: [{size: uint, mtime: uint, id: string}] // each version the server has (null if the server didn't answered)
	}
Non-leaf items has these keys:
	{
	watcher: bool,
	uploader: bool,
	items: hash // sub-items
	}
Each bool indicate whether this branch exists in the respective tree

## 102: getWatchedFolders -> folders[]: (name: string, files: uint), lastCicleTime: uint

## 103: addWatchFolder(string folder) -> folders[]: (name: string, files: uint), lastCicleTime: uint
Return the new set of watched folders

## 104: removeWatchFolder(string folder) -> folders[]: (name: string, files: uint), lastCicleTime: uint
Return the new set of watched folders

## 105: getQuotaUsage() -> (uint total, uint free, uint softUse)
Throw: SERVER_IS_DOWN
Return info about the current user quota (in bytes)
softUse is the space taken by old versions (space that can be freed whenever needed)

## 106: getFoldersInDir(dir: string) -> folders[]: string
Like readdir, except that only return sub-directories

## 107: getDiskUnits -> units[]: string
Return the available units names, like "C:", "D:", etc

## 108: startRestore(destination: string, files: string)
Start a new restoration job
files is a JSON-encoded tree (the same format accepted by Tree.js node-module)

# Server calls

## 100: uploaderProgress(bool connected, uint queueLength, string file, uint size, float progress) -> ()
Broadcast any update to the uploader status
If idle, file will be an empty string
