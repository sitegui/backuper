"use strict"

// Store all the configurations for the backuper server
module.exports = {
	port: 8001,
	uploadPort: 8002,
	mongoURL: "mongodb://localhost/backuper",
	// The folder to store all the data (should end with path.sep)
	dataFolder: "E:\\backuper\\",
	// Temp folder to store uploads in progress (should end with path.sep)
	tempFolder: "temp\\",
	// Temp folder to store chunk uploads in progress (should end with path.sep)
	tempChunksFolder: "temp\\chunks\\",
	// The maximum time to let temp files live (in ms)
	maxAge: 7*24*60*60*1e3
}
