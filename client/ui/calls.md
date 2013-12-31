# Client calls

## 100: getWatcherStatus() -> (string status)
Return the JSON-encoded version of Watcher.getStatus()

## 101: getUploaderStatus() -> (string status)
Return the JSON-encoded version of Uploader.getStatus()

# Server calls

## 100: uploaderProgress(string status) -> ()
Broadcast any update to the uploader status
