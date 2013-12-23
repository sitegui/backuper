// Create the keys file

var crypto = require("crypto")
var fs = require("fs")

var password = process.argv[2]

if (!password)
	throw new Error("Please provide your password as an argument")


var keys = crypto.pbkdf2Sync(password, "sitegui-backuper", 1000, 48)

fs.writeFileSync("keys", keys)

console.log("Done!")
