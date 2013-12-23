var FileWatcher = require("./FileWatcher.js")
var Uploader = require("./Uploader.js")
var config = require("./config.js")

// Set-up uploader
Uploader.start(config.uploader)
Uploader.on("start", function () {
	// Set-up the filewatcher
	FileWatcher.start(config.fileWatcher)
	FileWatcher.on("start", function () {
		if (FileWatcher.getFolders().length == 0) {
			FileWatcher.addFolder("C:\\Users\\Guilherme")
			FileWatcher.addFolder("C:\\Program Files (x86)\\Zend\\Apache2\\htdocs")
		}
	})
	
	// Plug the fileWatcher and uploader together
	FileWatcher.on("filechange", function (file) {
		Uploader.queueFile(file)
	})
})
