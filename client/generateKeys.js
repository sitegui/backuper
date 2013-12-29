// Create the keys file
// usage: node generateKeys.js <my-password>

"use strict"

var crypto = require("crypto")
var fs = require("fs")

var password = process.argv[2]

if (!password)
	throw new Error("Please provide your password as an argument")

var keys = crypto.pbkdf2Sync(password, "sitegui-backuper", 1000, 32)

fs.writeFileSync("keys", keys)

console.log("File keys created")

// Show the hashed password (to create the user account in the server)
console.log("Tell the server administrator your password is:")
console.log(keys.slice(0, 16).toString("hex"))
