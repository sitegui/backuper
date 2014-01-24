# Exceptions

## #1 notLoggedIn
## #2 outOfSpace
## #3 invalidSession
## #4 loginError
## #5 wrongSize
## #6 corruptedData
## #7 notFound
## #8 invalidVersion
## #9 invalidFile

# Client calls

## #1 login(userName: string, password: token)
Throws: "loginError"
The password is stored in the first 16B of "keys" file

## #2 startUpload(filePath: Buffer, mtime: int, size: uint, originalHash: Buffer) -> uploadId: string
Throws: "notLoggedIn", "outOfSpace"
originalHash is the sha1 of the original (decrypted) file
Create a new upload session for a given file
Return the session id that should be used to upload each file chunk

## #3 uploadChunk(uploadId: string, hash: Buffer, chunk: Buffer)
Throws: "notLoggedIn", "invalidSession", "corruptedData"
Create a chunk upload session
`hash` is the SHA1 hash of the chunk data
`chunk` is the encrypted chunk
This call will only return after the file is completely copied to final destination. This may take a while, so it's a good practice to use a greater timeout value

## #5 cancelUpload(id: string)
Throws: "notLoggedIn"

## #6 commitUpload(id: string)
Throws: "notLoggedIn", "invalidSessions", "wrongSize"
Close the given upload session and commit the submited file
This call will only return after the file is completely copied to final destination

## #7 removeFile(filePath: Buffer)
Throws: "notLoggedIn"

## #8 getFilesInfo -> files[]: (path: Buffer, versions[]: (size: uint, mtime: int, id: string))
Throws: "notLoggedIn"
Return the info about all files for the current user

## #9 getQuotaUsage -> total: uint, free: uint, softUse: uint
Return info about the current user quota (in bytes)
softUse is the space taken by old versions (space that can be freed whenever needed)

## #10 requestFileDownload(uploadId: string) -> downloadToken: token, size: uint, originalHash: Buffer
Throws: "notLoggedIn", "notFound"
To continue the download, the client should open another connection to downloadPort and send the token

## #11 getCurrentVersion -> version: string
Return the lastest client version string
If the current version is different, the client should close the connection and update itself first

## #12 getUpdateFileList(version: string) -> files[]: string
Throw invalidVersion if the given version isn't the last one anymore
Return the list of file paths to download

## #13 getUpdatedFile(file: string, version: string) -> data: Buffer, hash: Buffer
Throws: "invalidVersion", "invalidFile"
Throw "invalidVersion" if the given version isn't the last one anymore
Return the file content and its sha1 hash
