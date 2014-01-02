/*global aP*/
"use strict"

// Creates a new aP.DataArray with the given format for each element
aP.DataArray = function (format) {
	this.buffer = new aP.DataBuffer
	this.format = format
	this.length = 0 // number of elements
}

// Appends a new data element to the array
aP.DataArray.prototype.addData = function (data) {
	if (data.format != this.format)
		throw new TypeError("Data element must match the aP.DataArray format: '"+data.format+"' was given, '"+this.format+"' was expected")
	this.buffer.append(data.buffer)
	this.length++
	return this
}
