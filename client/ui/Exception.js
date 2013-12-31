/*global aP*/
"use strict"

// Creates a new protocol exception, with the given type (int) e data
// data (optional) must be a aP.Data, aP.DataArray or string
// data must match the format registered with aP.registerException
aP.Exception = function (type, data) {
	var format
	
	// Validates the data format
	data = aP.Data.toData(data)
	format = aP._registeredExceptions[type]
	if (!format)
		throw new Error("Invalid exception type "+type)
	if (data.format != format.formatString)
		throw new Error("Invalid data type '"+format.formatString+"' for exception "+type)
	
	this.type = type
	this.data = data
}
