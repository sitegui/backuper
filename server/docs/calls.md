# Exceptions

## NOT_LOGGED_IN (1)
## OUT_OF_SPACE (2)
## INVALID_SESSION (3)
## LOGIN_ERROR (4)
## WRONG_SIZE (5)
## CORRUPTED_DATA (6)

# Client calls

## 1: login(string userName, token password) -> ()
Throws: LOGIN_ERROR
The password is stored in the first 16B of "keys" file

## 2: startUpload(Buffer filePath, uint mtime, uint size, Buffer originalHash) -> (string uploadId)
Throws: NOT_LOGGED_IN, OUT_OF_SPACE
originalHash is the sha1 of the original (decrypted) file
Create a new upload session for a given file
Return the session id that should be used to upload each file chunk

## 3: startChunkUpload(string uploadId, Buffer hash) -> (string chunkId)
Throws: NOT_LOGGED_IN, INVALID_SESSION
Create a chunk upload session
Hash is the SHA1 hash of the chunk data
To continue the upload, the client should open another connection to port 8002,
and send the token and the whole chunk then close the socket

## 4: commitChunk(string chunkId) -> ()
Throws: NOT_LOGGED_IN, INVALID_SESSION, CORRUPTED_DATA
Don't call it more than once for the same chunk upload session
This call will only return after the file is completely copied to final destination

## 5: cancelUpload(string uploadId) -> ()
Throws: NOT_LOGGED_IN

## 6: commitUpload(string uploadId) -> ()
Throws: NOT_LOGGED_IN, INVALID_SESSION, WRONG_SIZE
Close the given upload session and commit the submited file
This call will only return after the file is completely copied to final destination

## 7: removeFile(Buffer filePath) -> ()
Throws: NOT_LOGGED_IN

## 8: getFilesInfo() -> ((Buffer path, (uint size, uint mtime, string id)[] versions)[] files)
Throws: NOT_LOGGED_IN
Return the info about all files for the current user

## 9: getQuotaUsage() -> (uint total, uint free, uint softUse)
Return info about the current user quota (in bytes)
softUse is the space taken by old versions (space that can be freed whenever needed)
