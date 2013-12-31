/*global aP*/
"use strict"

// Creates a new token
// If base (a aP.Token or Uint8Array) is given, copy its contents
// If not, creates a new random token
aP.Token = function (base) {
	var i
	this.buffer = new Uint8Array(16)
	if (base)
		if (base instanceof Uint8Array && base.length == 16)
			this.buffer.set(base)
		else if (base instanceof aP.Token)
			this.buffer.set(base.buffer)
		else
			throw new TypeError("Invalid base argument for new aP.Token")
	else 
		for (i=0; i<16; i++)
			this.buffer[i] = Math.floor(256*Math.random())
}

// Returns true if both token are equal to the given token
aP.Token.prototype.isEqual = function (token) {
	var i
	for (i=0; i<16; i++)
		if (this.buffer[i] != token.buffer[i])
			return false
	return true
}
