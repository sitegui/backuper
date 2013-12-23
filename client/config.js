"use strict"

// Store all the configurations for the backuper
module.exports = {
	// FileWatcher module configs
	fileWatcher: {
		// File used to save the current state
		dumpFile: "fileWatcher.dump",
		// In ms. Each cicle is a complete tree scan
		timeBetweenCicles: 1*24*60*60*1e3,
		// Number of folders to open at each step
		foldersPerStep: 10,
		// In ms
		timeBetweenSteps: 5*60*1e3
	},
	// Uploader module configs
	uploader: {
		// File in which the current state will be saved
		dumpFile: "uploader.dump",
		host: "localhost",
		port: 8001,
		userName: "Guilherme Souza",
		// Time between each reconnection attempts
		reconnectionTime: 1*60*60*1e3
	}
}
