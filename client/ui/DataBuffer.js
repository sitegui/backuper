/*global aP*/
"use strict"

// Creates a resizable Uint8Array with the given initial length
// length can be omitted, in this case 128 will be used
aP.DataBuffer = function (length) {
	this.buffer = new Uint8Array(length || 128) // allocated buffer
	this.length = 0 // number of used bytes
}

// Appends a byte (uint8 in a number) or a buffer (Uint8Array or aP.DataBuffer) to this aP.DataBuffer
// Automatically increase the internal buffer size if needed
aP.DataBuffer.prototype.append = function (x) {
	if (typeof x == "number") {
		this._alloc(1)
		this.buffer[this.length] = x
		this.length++
	} else if (x instanceof Uint8Array) {
		this._alloc(x.length)
		this.buffer.set(x, this.length)
		this.length += x.length
	} else if (x instanceof aP.DataBuffer) {
		this._alloc(x.length)
		this.buffer.set(x.buffer.subarray(0, x.length), this.length)
		this.length += x.length
	} else
		throw new TypeError("number, Uint8Array or aP.DataBuffer expected")
}

// Makes sure there is enough free space to allocate the given amount of bytes
aP.DataBuffer.prototype._alloc = function (amount) {
	var newBuffer
	if (this.length+amount > this.buffer.length) {
		newBuffer = new Uint8Array(this.buffer.length*2)
		newBuffer.set(this.buffer.subarray(0, this.length))
		this.buffer = newBuffer
		this._alloc(amount)
	}
}
