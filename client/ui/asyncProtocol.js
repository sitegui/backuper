require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict"

// Wrap a given WebSocket connection with the asyncProtocol
// context is a Context object that will emit events for calls received by this connection
// Events: open(), close()
function Connection(socket, context) {
	// Store the underlying socket
	this._socket = socket
	this._context = context
	
	// Store the last received and sent auto-increment ids
	this._lastReceivedID = 0
	this._lastSentID = 0
	
	// List of calls waiting for an answer
	// Each element is an array: [callInfo, callback, interval]
	this._calls = []
	
	// Set listeners for socket events
	this._socket.that = this
	this._socket.binaryType = "arraybuffer"
	this._socket.onclose = this._onclose
	this._socket.onmessage = this._onmessage
	this._socket.onopen = function () {
		var that = this.that
		that._ready = true
		if (that.onopen)
			that.onopen.call(that)
	}
	
	// True if the connection has been closed
	this._ready = false
}

// Export and require everything
module.exports = Connection
var inflateData = require("./inflateData.js")
var Data = require("./Data.js")
var Exception = require("./Exception.js")
var deflateData = require("./deflateData.js")

// Returns if the connection has closed
Object.defineProperty(Connection.prototype, "ready", {get: function () {
	return this._ready
}})

// Send a call to the other side
// name is the call name as a string
// data is the argument data (optional, must match the format registered in the context)
// callback(err, data) is a callback (optional)
// timeout is the maximum time this endpoint will wait for a return/exception (optional, default: 60e3)
// Inside the callbacks, this will be the Connection object
Connection.prototype.call = function (name, data, callback, timeout) {
	var registeredCalls, meta, interval, call
	
	// Validates the data
	if (!this._ready)
		throw new Error("The connection isn't opened")
	registeredCalls = this._context._clientCalls
	call = registeredCalls[name]
	if (!call)
		throw new Error("Invalid call "+name)
	data = deflateData(data, call.args)
	
	// Creates the protocol meta-data
	meta = new Data().addUint(call.id).addUint(++this._lastSentID)
	
	// Send the message
	this._socket.send(meta.addData(data).toBuffer())
	
	// Set timeout
	timeout = timeout===undefined ? 60e3 : timeout
	if (timeout)
		interval = setTimeout(this._getTimeoutCallback(), timeout)
	
	// Save info about the sent call
	// [callData, callback, interval]
	this._calls[this._lastSentID] = [call, callback, interval]
}

// Close the connection (don't wait for more data)
Connection.prototype.close = function () {
	this._socket.close()
}

// Returns a callback to treat the timeout
Connection.prototype._getTimeoutCallback = function () {
	var that = this, id = this._lastSentID
	return function () {
		var call = that._calls[id]
		delete that._calls[id]
		if (call && call[1])
			call[1].call(that, new Exception("timeout", null), null)
	}
}

// Inform the connection has been closed (send "closed" exception to every pending call)
Connection.prototype._onclose = function () {
	var i, call, calls, that
	
	// Clear everything
	that = this.that
	calls = that._calls
	that._calls = {}
	that._ready = false
	if (that.onclose)
		that.onclose.call(that)
	
	for (i in calls)
		// Foreach openned call, dispatch the error exception
		if (calls.hasOwnProperty(i)) {
			call = calls[i]
			if (call[2])
				clearTimeout(call[2])
			if (call[1])
				call[1].call(that, new Exception("closed", null), null)
		}
}

// Process the incoming message (a Buffer)
Connection.prototype._onmessage = function (message) {
	var type, callID, that = this.that
	message = new Uint8Array(message.data)
	
	// Extracts the message type and sequence id
	var state = {buffer: message, offset: 0}
	try {
		type = inflateData.readUint(state)
		callID = inflateData.readUint(state)
	} catch (e) {
		that._protocolError()
	}
	
	if (type)
		// A call from the other side
		that._processCall(callID, type, message.subarray(state.offset))
	else {
		try {
			type = inflateData.readUint(state)
		} catch (e) {
			that._protocolError()
		}
		if (type)
			// An exception from the other side
			that._processException(callID, type, message.subarray(state.offset))
		else
			// A return from the other side
			that._processReturn(callID, message.subarray(state.offset))
	}
}

// Process an incoming call
Connection.prototype._processCall = function (callID, type, dataBuffer) {
	var that = this
	
	// Check the sequence ID
	if (callID != ++this._lastReceivedID) {
		this._protocolError()
		return
	}
	
	// Get call definition
	var callInfo = this._context._serverCalls[type]
	if (!callInfo) {
		this._protocolError()
		return
	}
	
	// Read the incoming data
	var args
	try {
		args = inflateData(dataBuffer, callInfo.args)
	} catch (e) {
		// Invalid format
		this._protocolError()
		return
	}
	
	// Create the answer callback
	// obj can be an Exception or a Data (or convertable to Data) in the call-return format
	// If the connection has already been closed, returns false (true otherwise)
	var answered = false
	var answer = function (obj) {
		var exceptionInfo
		if (answered)
			throw new Error("Answer already sent")
		if (!that._ready)
			return false
		if (obj instanceof Exception) {
			exceptionInfo = that._context._exceptions[obj.name]
			if (!exceptionInfo)
				throw new Error("Invalid exception "+obj.name)
			that._sendAnswer(callID, exceptionInfo.id, deflateData(obj.data, exceptionInfo.args))
		} else
			that._sendAnswer(callID, 0, deflateData(obj, callInfo.outArgs))
		answered = true
		return true
	}
	
	if (!callInfo.callback)
		throw new Error("Callback for "+callInfo.name+" not registered")
	callInfo.callback.call(this, args, answer)
}

// Process a return
Connection.prototype._processReturn = function (callID, dataBuffer) {
	var callInfo, data
	
	callInfo = this._calls[callID]
	delete this._calls[callID]
	if (!callInfo) {
		// Received a timeouted (or invalid) answer
		this._protocolError()
		return
	}
	
	// Read the incoming data
	try {
		data = inflateData(dataBuffer, callInfo[0].outArgs)
	} catch (e) {
		// Invalid format
		this._protocolError()
		return
	}
	
	// Clear the timeout
	if (callInfo[2])
		clearTimeout(callInfo[2])
	
	// Call the callback
	if (callInfo[1])
		callInfo[1].call(this, null, data)
}

// Process a returned exception
Connection.prototype._processException = function (callID, type, dataBuffer) {
	var callInfo, args, exceptionInfo
	
	callInfo = this._calls[callID]
	delete this._calls[callID]
	if (!callInfo) {
		// Received a timeouted (or invalid) answer
		this._protocolError()
		return
	}
	
	// Get exception definition
	exceptionInfo = this._context._exceptions[type]
	if (!exceptionInfo) {
		this._protocolError()
		return
	}
	
	// Read the incoming data
	try {
		args = inflateData(dataBuffer, exceptionInfo.args)
	} catch (e) {
		// Invalid format
		this._protocolError()
		return
	}
	
	// Clear the timeout
	if (callInfo[2])
		clearTimeout(callInfo[2])
	
	// Call the callback
	if (callInfo[1])
		callInfo[1].call(this, new Exception(exceptionInfo.name, args), null)
}

// Treats a protocol error (close the connection)
Connection.prototype._protocolError = function () {
	this._socket.close()
}

// Sends an answer (return or exception)
Connection.prototype._sendAnswer = function (callID, exceptionType, data) {
	var meta = new Data().addUint(0).addUint(callID).addUint(exceptionType)
	
	// Send the message
	this._socket.send(meta.addData(data).toBuffer())
}

},{"./Data.js":3,"./Exception.js":4,"./deflateData.js":6,"./inflateData.js":10}],2:[function(require,module,exports){
"use strict"

// Represent a collection of registered calls and exceptions
// Every connection is bind to a context at creation time
function Context() {
	// Store registered entities by their name and id
	this._clientCalls = Object.create(null)
	this._serverCalls = Object.create(null)
	this._exceptions = Object.create(null)
}

module.exports = Context
var expand = require("./expand.js")
var Connection = require("./Connection.js")

// Register a new type of call that the server can make
// signature have the syntax described in the file expand.js
// callback(args, answer) is optional and will be called when this call is received
// Inside the callback, "this" will refer to the connection that received the call
Context.prototype.registerServerCall = function (signature, callback) {
	var data = expand.expandCallSignature(signature)
	data.callback = callback
	
	if (Math.round(data.id) != data.id || data.id < 1)
		throw new TypeError("id must be a non-zero unsigned integer")
	if (data.name in this._serverCalls)
		throw new Error("Unable to register server call "+data.name+", it has already been registered")
	this._serverCalls[data.name] = data
	this._serverCalls[data.id] = data
}

// Register a new type of call that clients can make
// signature have the syntax described in the file expand.js
Context.prototype.registerClientCall = function (signature) {
	var data = expand.expandCallSignature(signature)
	
	if (Math.round(data.id) != data.id || data.id < 1)
		throw new TypeError("id must be a non-zero unsigned integer")
	if (data.name in this._clientCalls)
		throw new Error("Unable to register client call "+data.name+", it has already been registered")
	this._clientCalls[data.name] = data
	this._clientCalls[data.id] = data
}

// Register a new type of exception
Context.prototype.registerException = function (signature) {
	var data = expand.expandExceptionSignature(signature)
	
	if (Math.round(data.id) != data.id || data.id < 1)
		throw new TypeError("id must be a non-zero unsigned integer")
	if (data.name === "timeout" || data.name === "closed" || data.name in this._exceptions)
		throw new Error("Unable to register exception "+data.name+", it has already been registered")
	this._exceptions[data.name] = data
	this._exceptions[data.id] = data
}

// Create a WebSocket connection with the given url
// Return a new Connection object
Context.prototype.connect = function (url) {
	return new Connection(new WebSocket(url), this)
}

},{"./Connection.js":1,"./expand.js":7}],3:[function(require,module,exports){
"use strict"

// Creates a new Data object to store encoded data in the protocol format
function Data() {
	this.buffer = new Uint8Array(128) // a resizable buffer
	this.length = 0 // number of used bytes
}

module.exports = Data

// Makes sure there is enough free space to allocate the given amount of bytes
Data.prototype.alloc = function (amount) {
	var newBuffer
	if (this.length+amount > this.buffer.length) {
		newBuffer = new Uint8Array(this.buffer.length*2)
		newBuffer.set(this.buffer.subarray(0, this.length))
		this.buffer = newBuffer
		this.alloc(amount)
	}
}

// Appends a byte (uint8 in a number) to the internal buffer
// Automatically increase the internal buffer size if needed
Data.prototype.append = function (x) {
	if (typeof x === "number") {
		this.alloc(1)
		this.buffer[this.length] = x
		this.length++
	} else if (x instanceof Uint8Array) {
		this.alloc(x.length)
		this.buffer.set(x, this.length)
		this.length += x.length
	} else if (x instanceof Data) {
		this.alloc(x.length)
		this.buffer.set(x.buffer.subarray(0, x.length), this.length)
		this.length += x.length
	} else
		throw new TypeError("number or Uint8Array expected")
}

// Appends a unsigned integer to the data
Data.prototype.addUint = function (u) {
	// Validates the input
	if (Math.round(u) != u || u > Data.MAX_DOUBLE_INT || u < 0)
		throw new TypeError("Unsigned integer expected")
	
	// First byte
	if (u <= Data.MAX_UINT_1_B) {
		this.append(Data.OFFSET_1_B+(u&Data.MASK_7_B))
		u = 0
	} else if (u <= Data.MAX_UINT_2_B) {
		this.append(Data.OFFSET_2_B+(u&Data.MASK_6_B))
		u >>= 6
	} else if (u <= Data.MAX_UINT_3_B) {
		this.append(Data.OFFSET_3_B+(u&Data.MASK_5_B))
		u >>= 5
	} else if (u <= Data.MAX_UINT_4_B) {
		this.append(Data.OFFSET_4_B+(u&Data.MASK_4_B))
		u >>= 4
	} else if (u <= Data.MAX_UINT_5_B) {
		this.append(Data.OFFSET_5_B+(u>Data.MAX_INT ? u%_POWS2[3] : u&Data.MASK_3_B))
		u = u>Data.MAX_INT ? Math.floor(u/8) : u>>3
	} else if (u <= Data.MAX_UINT_6_B) {
		this.append(Data.OFFSET_6_B+(u%_POWS2[2]))
		u = Math.floor(u/4)
	} else if (u <= Data.MAX_UINT_7_B) {
		this.append(Data.OFFSET_7_B+(u%_POWS2[1]))
		u = Math.floor(u/2)
	} else {
		this.append(Data.OFFSET_8_B)
	}
	
	// Other bytes
	while (u) {
		this.append(u>Data.MAX_INT ? u%_POWS2[8] : u&Data.MASK_8_B)
		u = u>Data.MAX_INT ? Math.floor(u/256) : u>>8
	}
	
	return this
}

// Appends a signed integer to the data
Data.prototype.addInt = function (i) {
	var length
	
	// Validates the input
	if (Math.round(i) != i || Math.abs(i) >= -Data.MIN_INT_7_B)
		throw new TypeError("Signed integer expected")
	
	// First byte
	if (i >= Data.MIN_INT_1_B && i < -Data.MIN_INT_1_B) {
		i -= Data.MIN_INT_1_B
		this.append(Data.OFFSET_1_B+(i&Data.MASK_7_B))
		i = 0
		length = 0
	} else if (i >= Data.MIN_INT_2_B && i < -Data.MIN_INT_2_B) {
		i -= Data.MIN_INT_2_B
		this.append(Data.OFFSET_2_B+(i&Data.MASK_6_B))
		i >>= 6
		length = 1
	} else if (i >= Data.MIN_INT_3_B && i < -Data.MIN_INT_3_B) {
		i -= Data.MIN_INT_3_B
		this.append(Data.OFFSET_3_B+(i&Data.MASK_5_B))
		i >>= 5
		length = 2
	} else if (i >= Data.MIN_INT_4_B && i < -Data.MIN_INT_4_B) {
		i -= Data.MIN_INT_4_B
		this.append(Data.OFFSET_4_B+(i&Data.MASK_4_B))
		i >>= 4
		length = 3
	} else if (i >= Data.MIN_INT_5_B && i < -Data.MIN_INT_5_B) {
		i -= Data.MIN_INT_5_B
		this.append(Data.OFFSET_5_B+(i > Data.MAX_INT ? i%_POWS2[3] : i&Data.MASK_3_B))
		i = i > Data.MAX_INT ? Math.floor(i/8) : i>>3
		length = 4
	} else if (i >= Data.MIN_INT_6_B && i < -Data.MIN_INT_6_B) {
		i -= Data.MIN_INT_6_B
		this.append(Data.OFFSET_6_B+(i%_POWS2[2]))
		i = Math.floor(i/4)
		length = 5
	} else {
		i -= Data.MIN_INT_7_B
		this.append(Data.OFFSET_7_B+(i%_POWS2[1]))
		i = Math.floor(i/2)
		length = 6
	}
	
	// Other bytes
	while (length--) {
		this.append(i>Data.MAX_INT ? i%_POWS2[8] : i&Data.MASK_8_B)
		i = i>Data.MAX_INT ? Math.floor(i/256) : i>>8
	}
	
	return this
}

// Appends a float to the data
Data.prototype.addFloat = function (f) {
	this.alloc(4)
	var view = new DataView(this.buffer.buffer)
	view.setFloat32(this.length, f, true)
	this.length += 4
	return this
}

// Appends a aP.Token to the data
Data.prototype.addToken = function (t) {
	this.append(t._buffer)
	return this
}

// Appends a string to the data
Data.prototype.addString = function (s) {
	var buffer, i, h, j
	
	// Extract to UTF-8 bytes
	buffer = new Data
	for (i=0; i<s.length; i++) {
		if (s.charCodeAt(i) < 128)
			buffer.append(s.charCodeAt(i))
		else {
			h = encodeURIComponent(s.charAt(i)).substr(1).split("%")
			for (j=0; j<h.length; j++)
				buffer.append(parseInt(h[j], 16))
		}
	}
	
	this.addUint(buffer.length)
	this.addData(buffer)
	return this
}

// Appends a Buffer to the data
Data.prototype.addBuffer = function (B) {
	this.addUint(B.length)
	this.append(B)
	return this
}

// Appends a boolean to the data
Data.prototype.addBoolean = function (b) {
	this.append(b ? 1 : 0)
	return this
}

// Appends another Data to this
Data.prototype.addData = function (data) {
	this.append(data)
	return this
}

// Returns a Uint8Array with all the data stored
Data.prototype.toBuffer = function () {
	return this.buffer.subarray(0, this.length)
}

// Stores 2^i from i=0 to i=56
var _POWS2 = (function () {
	var r = [], i, n = 1
	for (i=0; i<=56; i++) {
		r.push(n)
		n *= 2
	}
	return r
})()

// Pre-calculated constants
Data.MAX_DOUBLE_INT = _POWS2[53]-1
Data.MAX_INT = _POWS2[31]-1
Data.MAX_UINT_1_B = _POWS2[7]-1
Data.MAX_UINT_2_B = _POWS2[14]-1
Data.MAX_UINT_3_B = _POWS2[21]-1
Data.MAX_UINT_4_B = _POWS2[28]-1
Data.MAX_UINT_5_B = _POWS2[35]-1
Data.MAX_UINT_6_B = _POWS2[42]-1
Data.MAX_UINT_7_B = _POWS2[49]-1
Data.MIN_INT_1_B = -_POWS2[6]
Data.MIN_INT_2_B = -_POWS2[13]
Data.MIN_INT_3_B = -_POWS2[20]
Data.MIN_INT_4_B = -_POWS2[27]
Data.MIN_INT_5_B = -_POWS2[34]
Data.MIN_INT_6_B = -_POWS2[41]
Data.MIN_INT_7_B = -_POWS2[48]
Data.OFFSET_1_B = 0
Data.OFFSET_2_B = _POWS2[7]
Data.OFFSET_3_B = _POWS2[7]+_POWS2[6]
Data.OFFSET_4_B = _POWS2[7]+_POWS2[6]+_POWS2[5]
Data.OFFSET_5_B = _POWS2[7]+_POWS2[6]+_POWS2[5]+_POWS2[4]
Data.OFFSET_6_B = _POWS2[7]+_POWS2[6]+_POWS2[5]+_POWS2[4]+_POWS2[3]
Data.OFFSET_7_B = _POWS2[7]+_POWS2[6]+_POWS2[5]+_POWS2[4]+_POWS2[3]+_POWS2[2]
Data.OFFSET_8_B = _POWS2[7]+_POWS2[6]+_POWS2[5]+_POWS2[4]+_POWS2[3]+_POWS2[2]+_POWS2[1]
Data.MASK_1_B = _POWS2[0]
Data.MASK_2_B = _POWS2[0]+_POWS2[1]
Data.MASK_3_B = _POWS2[0]+_POWS2[1]+_POWS2[2]
Data.MASK_4_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]
Data.MASK_5_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]+_POWS2[4]
Data.MASK_6_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]+_POWS2[4]+_POWS2[5]
Data.MASK_7_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]+_POWS2[4]+_POWS2[5]+_POWS2[6]
Data.MASK_8_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]+_POWS2[4]+_POWS2[5]+_POWS2[6]+_POWS2[7]

},{}],4:[function(require,module,exports){
"use strict"

// Creates a new protocol exception, with the given name (string) and data
// data must match the format registered in the connection context
function Exception(name, data) {
	this.name = name
	this.data = data
}

module.exports = Exception

},{}],5:[function(require,module,exports){
"use strict"

// Creates a new token
// If base (a Token, 16-byte Buffer or hex encoded string) is given, copy its contents
// If not, creates a new pseudo-random token
function Token(base) {
	var i
	if (base)
		this._buffer = toTokenBuffer(base)
	else {
		this._buffer = new Uint8Array(16)
		for (i=0; i<16; i++)
			this._buffer[i] = Math.floor(256*Math.random())
	}
}

module.exports = Token

function toTokenBuffer(obj) {
	var buffer = new Uint8Array(16), i
	if (obj instanceof Uint8Array && obj.length === 16)
		buffer.set(obj)
	else if (obj instanceof Token)
		buffer.set(obj._buffer)
	else if (typeof obj === "string" && obj.match(/^[0-9a-fA-F]{32}$/))
		for (i=0; i<32; i+=2)
			buffer[i/2] = parseInt(obj.substr(i, 2), 16)
	else
		throw new TypeError("Invalid base argument for new Token")
	return buffer
}

// Returns true if both token are equal to the given token
// token can be a any value accept to create a new token
Token.prototype.isEqual = function (obj) {
	var buffer = toTokenBuffer(obj), i
	for (i=0; i<16; i++)
		if (this._buffer[i] != buffer[i])
			return false
	return true
}

// Return the hex encoded token
Token.prototype.toString = function () {
	var str = "", i, B
	for (i=0; i<16; i++) {
		B = this._buffer[i].toString(16)
		str += B.length==1 ? "0"+B : B
	}
	return str
}

},{}],6:[function(require,module,exports){
"use strict"

// Return the data in the given format
// obj is an object with the data to fit the given format
// format is an object created by expand.js
module.exports = function (obj, format) {
	var r = new Data
	fitInFormat(obj, format, r)
	return r
}

var Data = require("./Data.js")

function fitInFormat(obj, format, data) {
	var i, entry
	for (i=0; i<format.length; i++) {
		entry = format[i]
		if (!entry.array)
			fitInSimpleType(obj[entry.name], entry.type, data)
		else if (typeof entry.type === "string")
			fitInSimpleArray(obj[entry.name], entry.type, data)
		else
			fitInArray(obj[entry.name], entry.type, data)
	}
}

function fitInSimpleType(value, type, data) {
	if (type === "uint")
		data.addUint(value)
	else if (type === "int")
		data.addInt(value)
	else if (type === "float")
		data.addFloat(value)
	else if (type === "token")
		data.addToken(value)
	else if (type === "string")
		data.addString(value)
	else if (type === "Buffer")
		data.addBuffer(value)
	else
		data.addBoolean(value)
}

function fitInSimpleArray(value, type, data) {
	data.addUint(value.length)
	var i
	for (i=0; i<value.length; i++)
		fitInSimpleType(value[i], type, data)
}

function fitInArray(value, type, data) {
	data.addUint(value.length)
	var i
	for (i=0; i<value.length; i++)
		fitInFormat(value[i], type, data)
}

},{"./Data.js":3}],7:[function(require,module,exports){
"use strict"

// Expand a call signature with the format
//     #{id} {name}({args}) -> {returns}
// {id} is a decimal number
// {name} is the call identifier
// {args} and {returns} are optional and have similar syntax:
//     {field}, {field}, ...
// {field} can be a scalar field:
//     {name}:{type}
// or array field:
//     {name}[]:{type}
//     {name}[]:({field})
// {type} can be one of "uint", "int", "float", "string", "token", "Buffer" or "boolean"
// Examples:
//     #17 getSum(a: int, b: int) -> sum:int
//     #2 createUser(name: string, email: string, password: Buffer)
//     #5 getFolders -> folders[]:(name: string, ownerName: string, ownerId: uint)
//     #7 setTags(postId: int, tags[]:string)
// Return an object with keys "id", "name", "args", "outArgs"
module.exports.expandCallSignature = function (str) {
	// Ignore white spaces
	str = str.replace(/\s/g, "")
	
	// Extract the id and name
	var match = str.match(/^#([1-9][0-9]*)([a-zA-Z_][a-zA-Z0-9_]*)/)
	if (!match)
		throw new Error("Invalid format")
	
	// Extract args and return
	str = str.substr(match[0].length)
	var match2 = str.match(/^(\(.*?\))?(->.*?)?$/)
	if (!match2)
		throw new Error("Invalid format")
	return {
		id: Number(match[1]),
		name: match[2],
		args: expandFields(match2[1] ? match2[1].substr(1, match2[1].length-2) : ""),
		outArgs: expandFields(match2[2] ? match2[2].substr(2) : "")
	}
}

// Similar to expandCallSignature, except the syntax is
//     #{id} {name}({args})
// Return an object with keys "id", "name", "args"
module.exports.expandExceptionSignature = function (str) {
	// Ignore white spaces
	str = str.replace(/\s/g, "")
	
	// Extract the parts
	var match = str.match(/^#([1-9][0-9]*)([a-zA-Z_][a-zA-Z0-9_]*)(\(.*?\))?/)
	if (!match)
		throw new Error("Invalid format")
	
	return {
		id: Number(match[1]),
		name: match[2],
		args: expandFields(match[3] ? match[3].substr(1, match[3].length-2) : "")
	}
}

// Aux function of expandCallSignature to expand {args} and {returns}
function expandFields(str) {
	var tree = expandParenthesis(str)
	
	var expandLevel = function (tree) {
		var i, str, match, r = [], type
		r.format = ""
		for (i=0; i<tree.length; i++) {
			str = tree[i]
			if (typeof str !== "string")
				throw new Error("Invalid format")
			
			// Look for simple cases: "name:type" and "name[]:type"
			match = str.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\[\])?:(uint|int|float|string|token|Buffer|boolean)$/)
			if (match) {
				r.push({name: match[1], array: Boolean(match[2]), type: match[3]})
				r.format += match[2] ? "("+match[3][0]+")" : match[3][0]
				continue
			}
			
			// Check harder case: this element is "name[]:" and the next is an array
			if (!str.match(/^[a-zA-Z_][a-zA-Z0-9_]*\[\]:$/) || !Array.isArray(tree[i+1]))
				throw new Error("Invalid format")
			type = expandLevel(tree[i+1])
			r.push({name: str.substr(0, str.length-3), array: true, type: type})
			r.format += "("+type.format+")"
			i++
		}
		return r
	}
	
	return expandLevel(tree)
}

// Aux function of expandFields
function expandParenthesis(str) {
	var tree = [], i, c, subtree
	var cache = ""
	var saveCache = function () {
		if (cache) {
			tree.push(cache)
			cache = ""
		}
	}
	for (i=0; i<str.length; i++) {
		c = str[i]
		if (c == "(") {
			saveCache()
			subtree = []
			tree.push(subtree)
			subtree.parent = tree
			tree = subtree
		} else if (c == ")") {
			saveCache()
			if (!tree.parent)
				throw new Error("Parenthesis mismatch")
			subtree = tree.parent
			delete tree.parent
			tree = subtree
		} else if (c == ",") {
			saveCache()
		} else
			cache += c
	}
	saveCache()
	if (tree.parent)
		throw new Error("Parenthesis mismatch")
	
	return tree
}

},{}],"j9zVFQ":[function(require,module,exports){
// Require and export all external objects

"use strict"

var Exception = require("./Exception.js")
var Token = require("./Token.js")
var Context = require("./Context.js")

Context.Exception = Exception
Context.Token = Token

module.exports = Context

},{"./Context.js":2,"./Exception.js":4,"./Token.js":5}],"async-protocol-web":[function(require,module,exports){
module.exports=require('j9zVFQ');
},{}],10:[function(require,module,exports){
"use strict"

// Inflates a given data based on its format
// buffer is a Buffer
// format is an object created by expand module
// Returns an object or throws in case of error
function inflateData(buffer, format) {
	var state = {buffer: buffer, offset: 0}
	var data = inflateData.readElement(state, format)
	if (state.offset != buffer.length)
		throw new Error("Unable to read data in the given format")
	return data
}

module.exports = inflateData
var Data = require("./Data.js")
var Token = require("./Token.js")

// Extract a unsigned integer from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
inflateData.readUint = function (state) {
	var firstByte, u, length, i, shifts
	
	// Get the first byte
	if (state.offset >= state.buffer.length)
		throw new RangeError("Unable to extract unsigned integer from index "+state.offset)
	firstByte = state.buffer[state.offset]
	
	// Get the total length and the first bits
	if (firstByte < Data.OFFSET_2_B) {
		// Fast path
		state.offset++
		return firstByte
	} else if (firstByte < Data.OFFSET_3_B) {
		length = 1
		u = firstByte&Data.MASK_6_B
	} else if (firstByte < Data.OFFSET_4_B) {
		length = 2
		u = firstByte&Data.MASK_5_B
	} else if (firstByte < Data.OFFSET_5_B) {
		length = 3
		u = firstByte&Data.MASK_4_B
	} else if (firstByte < Data.OFFSET_6_B) {
		length = 4
		u = firstByte&Data.MASK_3_B
	} else if (firstByte < Data.OFFSET_7_B) {
		length = 5
		u = firstByte&Data.MASK_2_B
	} else if (firstByte < Data.OFFSET_8_B) {
		length = 6
		u = firstByte&Data.MASK_1_B
	} else if (firstByte == Data.OFFSET_8_B) {
		length = 7
		u = 0
	} else
		throw new Error("Unable to extract unsigned integer from index "+state.offset)
	
	// Get the remaining bytes
	if (state.offset+length >= state.buffer.length)
		throw new RangeError("Unable to extract unsigned integer from index "+state.offset)
	shifts = 7-length
	for (i=1; i<=length; i++) {
		u += (shifts < 24) ? (state.buffer[state.offset+i] << shifts) : (state.buffer[state.offset+i] * _POWS2[shifts])
		shifts += 8
	}
	
	state.offset += 1+length
	return u
}

// Extract a signed integer from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
inflateData.readInt = function (state) {
	var firstByte, i, length, j, shifts
	
	// Get the first byte
	if (state.offset >= state.buffer.length)
		throw new Error("Unable to extract signed integer from index "+state.offset)
	firstByte = state.buffer[state.offset]
	
	// Get the total length and the first bits
	if (firstByte < Data.OFFSET_2_B) {
		// Fast path
		state.offset++
		return firstByte+Data.MIN_INT_1_B
	} else if (firstByte < Data.OFFSET_3_B) {
		length = 1
		i = (firstByte&Data.MASK_6_B)+Data.MIN_INT_2_B
	} else if (firstByte < Data.OFFSET_4_B) {
		length = 2
		i = (firstByte&Data.MASK_5_B)+Data.MIN_INT_3_B
	} else if (firstByte < Data.OFFSET_5_B) {
		length = 3
		i = (firstByte&Data.MASK_4_B)+Data.MIN_INT_4_B
	} else if (firstByte < Data.OFFSET_6_B) {
		length = 4
		i = (firstByte&Data.MASK_3_B)+Data.MIN_INT_5_B
	} else if (firstByte < Data.OFFSET_7_B) {
		length = 5
		i = (firstByte&Data.MASK_2_B)+Data.MIN_INT_6_B
	} else if (firstByte < Data.OFFSET_8_B) {
		length = 6
		i = (firstByte&Data.MASK_1_B)+Data.MIN_INT_7_B
	} else
		throw new Error("Unable to extract signed integer from index "+state.offset)
	
	// Get the remaining bytes
	if (state.offset+length >= state.buffer.length)
		throw new Error("Unable to extract signed integer from index "+state.offset)
	shifts = 7-length
	for (j=1; j<=length; j++) {
		i += (shifts < 24) ? (state.buffer[state.offset+j] << shifts) : (state.buffer[state.offset+j] * _POWS2[shifts])
		shifts += 8
	}
	
	state.offset += 1+length
	return i
}

// Extract a float from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
inflateData.readFloat = function (state) {
	if (state.offset+4 > state.buffer.length)
		throw new Error("Unable to extract float from index "+state.offset)
	
	var r = new DataView(state.buffer.buffer).getFloat32(state.buffer.byteOffset+state.offset, true)
	state.offset += 4
	return r
}

// Extract a Token from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
inflateData.readToken = function (state) {
	if (state.offset+16 > state.buffer.length)
		throw new Error("Unable to extract token from index "+state.offset)
	
	var r = new Token(state.buffer.subarray(state.offset, state.offset+16))
	state.offset += 16
	return r
}

// Extract a string from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
inflateData.readString = function (state) {
	// Gets the string length
	var length = inflateData.readUint(state)
	
	if (state.offset+length > state.buffer.length)
		throw new Error("Unable to extract string from index "+state.offset)
	
	// Read from UTF-8 bytes
	var str = "", i, c
	for (i=0; i<length; i++) {
		c = state.buffer[state.offset+i]
		if (c < 128)
			str += c==0x25 ? "%25" : String.fromCharCode(c)
		else
			str += "%"+c.toString(16).toUpperCase()
	}
	var r = decodeURIComponent(str)
	state.offset += length
	return r
}

// Extract a Buffer from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
inflateData.readBuffer = function (state) {
	// Gets the buffer length
	var length = inflateData.readUint(state)
	
	if (state.offset+length > state.buffer.length)
		throw new Error("Unable to extract Buffer from index "+state.offset)
	
	var r = state.buffer.subarray(state.offset, state.offset+length)
	state.offset += length
	return r
}

// Extract a Buffer from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
inflateData.readBoolean = function (state) {
	var byte
	
	if (state.offset+1 > state.buffer.length)
		throw new Error("Unable to extract boolean from index "+state.offset)
	
	byte = state.buffer[state.offset]
	
	if (byte != 0 && byte != 1)
		throw new Error("Unable to extract boolean from index "+state.offset)
	
	state.offset++
	return Boolean(byte)
}

// Extract a simple element from the buffer
// type is one of "uint", "int", "float", "string", "token", "Buffer" or "boolean"
inflateData.readSimpleElement = function (state, type) {
	if (type === "uint")
		return inflateData.readUint(state)
	else if (type === "int")
		return inflateData.readInt(state)
	else if (type === "float")
		return inflateData.readFloat(state)
	else if (type === "token")
		return inflateData.readToken(state)
	else if (type === "string")
		return inflateData.readString(state)
	else if (type === "Buffer")
		return inflateData.readBuffer(state)
	else
		return inflateData.readBoolean(state)
}

// Extract a simple array, in which every element has the same simple type
// type is one of "uint", "int", "float", "string", "token", "Buffer" or "boolean"
inflateData.readSimpleArray = function (state, type) {
	var length = inflateData.readUint(state)
	var array = [], i
	
	// Extract all elements
	for (i=0; i<length; i++)
		array.push(inflateData.readSimpleElement(state, type))
	
	return array
}

// Extract an element from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
// format is a args expanded format
inflateData.readArray = function (state, format) {
	var length = inflateData.readUint(state)
	var array = [], i
	
	// Extract all elements
	for (i=0; i<length; i++)
		array.push(inflateData.readElement(state, format))
	
	return array
}

// Extract an element from the buffer (a Buffer) from the position offset
// state is an object with keys "buffer" and "offset". "offset" will be updated
// Throw in case of error
// format is a args expanded format
inflateData.readElement = function (state, format) {
	var data = Object.create(null)
	var i, entry
	for (i=0; i<format.length; i++) {
		entry = format[i]
		if (!entry.array)
			data[entry.name] = inflateData.readSimpleElement(state, entry.type)
		else if (typeof entry.type === "string")
			data[entry.name] = inflateData.readSimpleArray(state, entry.type)
		else
			data[entry.name] = inflateData.readArray(state, entry.type)
	}
	return data
}

// Stores 2^i from i=0 to i=56
var _POWS2 = (function () {
	var r = [], i, n = 1
	for (i=0; i<=56; i++) {
		r.push(n)
		n *= 2
	}
	return r
})()

},{"./Data.js":3,"./Token.js":5}]},{},[])