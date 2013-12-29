# Users
{
	userName: string, // unique
	password: Buffer, // SHA1 of the user login key
	localFolder: string // the local folder name to store all files for this user
}

# Folders
{
	user: string, // the user that owns this tree
	name: Buffer, // the aes128 encrypted folder name
	parent: Buffer // the aes128 encrypted folder name of the parent (null if root)
}

# Files
{
	user: string, // the user that owns this file
	name: Buffer, // the aes128 encrypted file name
	folder: Buffer, // the aes128 encrypted folder name of the parent (null if root)
	size: int, // the size (in bytes) of the whole file
	mtime: int, // the modification time (utc-hashed)
	version: int, // the incremental version id
	old: bool // indicate whether this file does not exist in the client disk anymore
}

# Uploads
{
	localName: string, // the local file name (in temp/) and also the id
	user: string, // the user that owns this session
	filePath: Buffer[],
	mtime: int,
	size: int
}
