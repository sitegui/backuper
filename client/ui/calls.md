# Client calls

## 100: getUploaderStatus() -> (string file, uint mtime, uint size, uint sentChunks)
Return the current upload status
If idle, file will be an empty string
Whenever this changes, the server will send uploaderProgress()

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

## 102: getWatchedFolders() -> (string[] folders)

## 103: addWatchFolder(string folder) -> (string[] folders)
Return the new set of watched folders

## 104: removeWatchFolder(string folder) -> (string[] folders)
Return the new set of watched folders

# Server calls

## 100: uploaderProgress(string file, uint mtime, uint size, uint sentChunks) -> ()
Broadcast any update to the uploader status
If idle, file will be an empty string
