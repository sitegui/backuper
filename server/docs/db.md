# Users
{
	name: string, // unique
	password: Buffer, // SHA1 of the user login key
	localName: string, // the local name to store all files for this user
	quota: int // the max number of bytes for this user account
}

# Files
{
	user: string, // the user that owns this file
	path: Buffer // the absolute path, aes128-encoded
	size: int, // the size (in bytes) of the whole file
	mtime: int, // the modification time (utc-hashed)
	version: int, // the incremental version id (0 is the most recent)
	old: bool, // indicate whether this file does not exist in the client disk anymore
	localName: string, // the name of file saved in the user folder
	originalHash: Buffer // the sha1 of the decrypted file
}

# Uploads
{
	localName: string, // the local file name (in temp/) and also the id
	user: string, // the user that owns this session
	filePath: Buffer,
	mtime: int,
	size: int,
	receivedChunks: int, // the number of chunks commited for this upload
	originalHash: Buffer,
	timestamp: int // the Date.now() of creation of this session
}
