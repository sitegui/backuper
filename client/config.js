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
		timeBetweenSteps: 45*1e3,
		// Array of RegExps for ignored files and folders
		ignore: [/^\./]
	},
	// Uploader module configs
	uploader: {
		// File in which the current state will be saved
		dumpFile: "uploader.dump",
		host: "localhost",
		port: 8001,
		uploadPort: 8002,
		userName: "Guilherme Souza",
		// Time between reconnection attempts (in ms)
		reconnectionTime: 45*1e3,
		// The limit for the average upload speed (in kbps)
		maxUploadSpeed: 1000
	},
	// UIServer module configs
	ui: {
		// port on the localhost to display the user interface
		port: 3000,
		// the port to listen to websocket connections
		wsPort: 3001
	}
}
