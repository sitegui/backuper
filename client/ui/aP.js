"use strict"

// Creates a new WebSocket connection with the asyncProtocol
// Events: open(), call(type, data, answer), close()
function aP(url) {
	// Store the underlying webSocket
	this.webSocket = new WebSocket(url)
	
	// Store the last received and sent auto-increment ids
	this._lastReceivedID = 0
	this._lastSentID = 0
	
	// List of calls waiting for an answer
	// Each element is an array: [callInfo, onreturn, onexception, interval]
	this._calls = []
	
	// Set listeners for webSocket events
	this.webSocket.that = this
	this.webSocket.binaryType = "arraybuffer"
	this.webSocket.onclose = this._onclose
	this.webSocket.onmessage = this._processMessage
	
	// True if the connection is open
	this._ready = false
}

// Register a new type of call that the server can make
aP.registerServerCall = function (id, argsFormat, returnFormat, exceptions) {
	if (Math.round(id) != id || id < 1)
		throw new TypeError("id must be a non-zero unsigned integer")
	if (id in aP._registeredServerCalls)
		throw new Error("Unable to register server call "+id+", it has already been registered")
	exceptions = exceptions || []
	aP._registeredServerCalls[id] = [aP.inflateFormat(argsFormat), aP.inflateFormat(returnFormat), exceptions]
	return id
}

// Register a new type of call that clients can make
aP.registerClientCall = function (id, argsFormat, returnFormat, exceptions) {
	if (Math.round(id) != id || id < 1)
		throw new TypeError("id must be a non-zero unsigned integer")
	if (id in aP._registeredClientCalls)
		throw new Error("Unable to register client call "+id+", it has already been registered")
	exceptions = exceptions || []
	aP._registeredClientCalls[id] = [aP.inflateFormat(argsFormat), aP.inflateFormat(returnFormat), exceptions]
	return id
}

// Register a new type of exception
aP.registerException = function (id, dataFormat) {
	if (Math.round(id) != id || id < 1)
		throw new TypeError("id must be a non-zero unsigned integer")
	if (id in aP._registeredExceptions)
		throw new Error("Unable to register exception "+id+", it has already been registered")
	aP._registeredExceptions[id] = aP.inflateFormat(dataFormat)
	return id
}

// Returns if the connection is oppened and ready
Object.defineProperty(aP.prototype, "ready", {get: function () {
	return this._ready
}})

// Send a call to the other side
// type is the call-type id (int)
// data is the argument data (optional, must be a aP.Data, aP.DataArray or string. Must match the format registered with aP.registerClientCall)
// onreturn(data) is a callback (optional)
// onexception(type, data) is a callback (optional)
// timeout is the maximum time this endpoint will wait for a return/exception (optional, default: 60e3)
// Inside the callbacks, this will be the aP object
aP.prototype.sendCall = function (type, data, onreturn, onexception, timeout) {
	var meta, length, interval, call
	
	// Validates the data
	if (!this._ready)
		throw new Error("The connection isn't ready")
	call = aP._registeredClientCalls[type]
	if (!call)
		throw new Error("Invalid call type "+type)
	data = aP.Data.toData(data)
	if (data.format != call[0].formatString)
		throw new Error("Invalid data type '"+data.format+"' for call "+type)
	
	// Creates the protocol meta-data
	meta = (new aP.Data).addUint(type).addUint(++this._lastSentID)
	length = (new aP.Data).addUint(meta.buffer.length+data.buffer.length)
	
	
	// Send the message
	this.webSocket.send(length.addData(meta).addData(data).toBuffer())
	
	// Set timeout
	timeout = timeout===undefined ? 60e3 : timeout
	if (timeout)
		interval = setTimeout(this._getTimeoutCallback(), timeout)
	
	// Save info about the sent call
	// [expectedReturnFormat, onreturn, onexception, interval]
	this._calls[this._lastSentID] = [call, onreturn, onexception, interval]
}

// Close the connection
aP.prototype.close = function () {
	this.webSocket.close()
}

// Registered calls
// Each element is an array: [inflatedArgsFormat, inflatedReturnFormat, exceptions]
aP._registeredServerCalls = {}
aP._registeredClientCalls = {}

// Registered exceptions
// Each element is an inflated format object
aP._registeredExceptions = {}

// Returns a callback to treat the timeout
aP.prototype._getTimeoutCallback = function () {
	var that = this, id = this._lastSentID
	return function () {
		var call = that._calls[id]
		delete that._calls[id]
		if (call) {
			if (call[3])
				clearInterval(call[3])
			if (call[2])
				call[2].call(that, 0, null)
		}
	}
}

// Inform the connection has been closed (send -1 exception to every pending call)
aP.prototype._onclose = function () {
	var i, call, that, calls
	
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
			if (call[3])
				clearInterval(call[3])
			if (call[2])
				call[2].call(that, -1, null)
		}
}

// Process the incoming message (a MessageEvent)
aP.prototype._processMessage = function (message) {
	var aux, type, callID, offset, that = this.that
	
	// First message: the connection is ready
	if (!that._ready) {
		that._ready = true
		if (that.onopen)
			that.onopen.call(that)
		return
	}
	
	// Extracts the message type and sequence id
	message = new Uint8Array(message.data)
	try {
		aux = []
		offset = aP.inflateData.readUint(message, 0, aux)
		offset = aP.inflateData.readUint(message, offset, aux)
		type = aux[0]
		callID = aux[1]
	} catch (e) {
		that._protocolError()
	}
	
	if (type)
		// A call from the other side
		that._processCall(callID, type, message.subarray(offset))
	else {
		try {
			offset = aP.inflateData.readUint(message, offset, aux)
			type = aux[2]
		} catch (e) {
			that._protocolError()
		}
		if (type)
			// An exception from the other side
			that._processException(callID, type, message.subarray(offset))
		else
			// A return from the other side
			that._processReturn(callID, message.subarray(offset))
	}
}

// Process an incoming call
aP.prototype._processCall = function (callID, type, dataBuffer) {
	var call, data, answer, answered, that = this
	
	// Check the sequence ID
	if (callID != ++this._lastReceivedID) {
		this._protocolError()
		return
	}
	
	// Get call definition
	call = aP._registeredServerCalls[type]
	if (!call) {
		this._protocolError()
		return
	}
	
	// Read the incoming data
	try {
		data = aP.inflateData(dataBuffer, call[0])
	} catch (e) {
		// Invalid format
		this._protocolError()
		return
	}
	
	// Create the answer callback
	// obj can be an aP.Exception or a aP.Data (or convertable to Data) in the call-return format
	// If the connection has already been closed, returns false (true otherwise)
	answered = false
	answer = function (obj) {
		var data
		if (answered)
			throw new Error("Answer already sent")
		if (!that._ready)
			return false
		if (obj instanceof aP.Exception) {
			if (call[2].indexOf(obj.type) == -1)
				throw new Error("Invalid exception "+obj.type+" to call "+type)
			that._sendAnswer(callID, obj.type, obj.data)
		} else {
			data = aP.Data.toData(obj)
			if (data.format != call[1].formatString)
				throw new Error("Invalid data type '"+data.format+"' for return "+type)
			that._sendAnswer(callID, 0, data)
		}
		answer = true
		return true
	}
	
	// Emmits the "call" event
	if (this.oncall)
		this.oncall.call(this, type, data, answer)
}

// Process a return
aP.prototype._processReturn = function (callID, dataBuffer) {
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
		data = aP.inflateData(dataBuffer, callInfo[0][1])
	} catch (e) {
		// Invalid format
		this._protocolError()
		return
	}
	
	// Clear the timeout
	if (callInfo[3])
		clearInterval(callInfo[3])
	
	// Call the callback
	if (callInfo[1])
		callInfo[1].call(this, data)
}

// Process a returned exception
aP.prototype._processException = function (callID, type, dataBuffer) {
	var callInfo, data, format
	
	callInfo = this._calls[callID]
	delete this._calls[callID]
	if (!callInfo) {
		// Received a timeouted (or invalid) answer
		this._protocolError()
		return
	}
	if (callInfo[0][2].indexOf(type) == -1) {
		// Received an invalid exception type
		this._protocolError()
		return
	}
	
	// Get exception definition
	format = aP._registeredExceptions[type]
	if (!format) {
		this._protocolError()
		return
	}
	
	// Read the incoming data
	try {
		data = aP.inflateData(dataBuffer, format)
	} catch (e) {
		// Invalid format
		this._protocolError()
		return
	}
	
	// Clear the timeout
	if (callInfo[3])
		clearInterval(callInfo[3])
	
	// Call the callback
	if (callInfo[2])
		callInfo[2].call(this, type, data)
}

// Treats a protocol error (close the connection)
aP.prototype._protocolError = function () {
	this.webSocket.close()
}

// Sends an answer (return or exception)
aP.prototype._sendAnswer = function (callID, exceptionType, data) {
	var meta, length
	
	// Creates the buffers
	meta = (new aP.Data).addUint(0).addUint(callID).addUint(exceptionType)
	length = (new aP.Data).addUint(meta.buffer.length+data.buffer.length)
	
	// Send the message
	this.webSocket.send(length.addData(meta).addData(data).toBuffer())
}
