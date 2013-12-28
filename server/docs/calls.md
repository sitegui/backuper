# Exceptions

## NOT_LOGGED_IN (1)
## OUT_OF_SPACE (2)
## INVALID_SESSION (3)
## LOGIN_ERROR (4)
## WRONG_SIZE (5)

# Client calls

## login(string userName, token password) -> ()
Throws: LOGIN_ERROR
The password is stored in the first 16B of "keys" file

## startUpload(Buffer[] filePath, uint mtime, uint size) -> (token uploadId)
Throws: NOT_LOGGED_IN, OUT_OF_SPACE
Create a new upload session for a given file
Return the session id that should be used to upload each file chunk

## startChunkUpload(token uploadId, Buffer hash) -> (token chunkId)
Throws: NOT_LOGGED_IN, INVALID_SESSION
Create a chunk upload session
Hash is the SHA1 hash of the chunk data
To continue the upload, the client should open another connection to port 8002,
and send the token and the whole chunk then close the socket

## commitChunk(token chunkId) -> ()
Throws: NOT_LOGGED_IN, INVALID_SESSION
Don't call it more than once for the same chunk upload session

## cancelUpload(token uploadId) -> ()

## commitUpload(token uploadId) -> ()
Throws: NOT_LOGGED_IN, INVALID_SESSION, WRONG_SIZE
Close the given upload session and commit the submited file
