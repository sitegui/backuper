"use strict";

// Store all the configurations for the backuper
module.exports = {
	// watcher module configs
	watcher: {
		// File used to save the current state
		dumpFile: "watcher.dump",
		// Number of folders to open at each step
		foldersPerStep: 10,
		// In ms
		timeBetweenSteps: 5*60*1e3,
		// Array of RegExps for ignored files and folders
		ignore: [/^\./, /^AppData$/]
	},
	// Uploader module configs
	uploader: {
		// File in which the current state will be saved
		dumpFile: "uploader.dump",
		// Time between reconnection attempts (in ms)
		reconnectionTime: 1*60*60*1e3,
		// The limit for the average upload speed (in kbps)
		maxUploadSpeed: 100
		// aesKey: null -> Read from file "keys"
		// aesIV: null -> Read from file "keys"
	},
	// Downloader module configs
	downloader: {
		// File in which the current state will be saved
		dumpFile: "downloader.dump",
		// host: "" -> got from connect.host
		downloadPort: 8003,
		// Time between reconnection attempts (in ms)
		reconnectionTime: 5*60*1e3,
		// Temp folder to store downloads in progress (should end with path.sep)
		tempFolder: "temp\\"
		// aesKey: null -> Read from file "keys"
	},
	// Server connection configuration
	connect: {
		host: "localhost",
		port: 8001,
		userName: "Guilherme Souza"
		// loginKey: null -> Read from file "keys"
	},
	// UIServer module configs
	ui: {
		// port on the localhost to display the user interface
		port: 3000,
		// the port to listen to websocket connections
		wsPort: 3001
	}
}
