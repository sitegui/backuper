/*global aP*/
"use strict"

// Inflates a given data based on its format
// buffer is a Uint8Array
// format is a InflatedFormat
// Returns an Array or throws in case of error
aP.inflateData = function (buffer, format) {
	var data = []
	if (aP.inflateData.readElement(buffer, 0, data, format) != buffer.length)
		throw new Error("Unable to read data in the given format")
	return format.length>1 ? data : (format.length ? data[0] : null)
}

// Extracts a unsigned integer from the buffer (an Uint8Array) from the position offset to the data Array
// Returns the new offset value or throws in case of error (RangeError means there isn't enough data in the buffer)
aP.inflateData.readUint = function (buffer, offset, data) {
	var firstByte, u, length, i, shifts
	
	// Get the first byte
	if (offset >= buffer.length)
		throw new RangeError("Unable to extract unsigned integer from index "+offset)
	firstByte = buffer[offset]
	
	// Get the total length and the first bits
	if (firstByte < aP.Data.OFFSET_2_B) {
		// Fast path
		data.push(firstByte)
		return offset+1
	} else if (firstByte < aP.Data.OFFSET_3_B) {
		length = 1
		u = firstByte&aP.Data.MASK_6_B
	} else if (firstByte < aP.Data.OFFSET_4_B) {
		length = 2
		u = firstByte&aP.Data.MASK_5_B
	} else if (firstByte < aP.Data.OFFSET_5_B) {
		length = 3
		u = firstByte&aP.Data.MASK_4_B
	} else if (firstByte < aP.Data.OFFSET_6_B) {
		length = 4
		u = firstByte&aP.Data.MASK_3_B
	} else if (firstByte < aP.Data.OFFSET_7_B) {
		length = 5
		u = firstByte&aP.Data.MASK_2_B
	} else if (firstByte < aP.Data.OFFSET_8_B) {
		length = 6
		u = firstByte&aP.Data.MASK_1_B
	} else if (firstByte == aP.Data.OFFSET_8_B) {
		length = 7
		u = 0
	} else
		throw new Error("Unable to extract unsigned integer from index "+offset)
	
	// Get the remaining bytes
	if (offset+length >= buffer.length)
		throw new RangeError("Unable to extract unsigned integer from index "+offset)
	shifts = 7-length
	for (i=1; i<=length; i++) {
		u += (shifts < 24) ? (buffer[offset+i] << shifts) : (buffer[offset+i] * _POWS2[shifts])
		shifts += 8
	}
	
	data.push(u)
	return offset+1+length
}

// Extracts a signed integer from the buffer (an Uint8Array) from the position offset to the data Array
// Returns the new offset value or throws in case of error
aP.inflateData.readInt = function (buffer, offset, data) {
	var firstByte, i, length, j, shifts
	
	// Get the first byte
	if (offset >= buffer.length)
		throw new Error("Unable to extract signed integer from index "+offset)
	firstByte = buffer[offset]
	
	// Get the total length and the first bits
	if (firstByte < aP.Data.OFFSET_2_B) {
		// Fast path
		data.push(firstByte+aP.Data.MIN_INT_1_B)
		return offset+1
	} else if (firstByte < aP.Data.OFFSET_3_B) {
		length = 1
		i = (firstByte&aP.Data.MASK_6_B)+aP.Data.MIN_INT_2_B
	} else if (firstByte < aP.Data.OFFSET_4_B) {
		length = 2
		i = (firstByte&aP.Data.MASK_5_B)+aP.Data.MIN_INT_3_B
	} else if (firstByte < aP.Data.OFFSET_5_B) {
		length = 3
		i = (firstByte&aP.Data.MASK_4_B)+aP.Data.MIN_INT_4_B
	} else if (firstByte < aP.Data.OFFSET_6_B) {
		length = 4
		i = (firstByte&aP.Data.MASK_3_B)+aP.Data.MIN_INT_5_B
	} else if (firstByte < aP.Data.OFFSET_7_B) {
		length = 5
		i = (firstByte&aP.Data.MASK_2_B)+aP.Data.MIN_INT_6_B
	} else if (firstByte < aP.Data.OFFSET_8_B) {
		length = 6
		i = (firstByte&aP.Data.MASK_1_B)+aP.Data.MIN_INT_7_B
	} else
		throw new Error("Unable to extract signed integer from index "+offset)
	
	// Get the remaining bytes
	if (offset+length >= buffer.length)
		throw new Error("Unable to extract signed integer from index "+offset)
	shifts = 7-length
	for (j=1; j<=length; j++) {
		i += (shifts < 24) ? (buffer[offset+j] << shifts) : (buffer[offset+j] * _POWS2[shifts])
		shifts += 8
	}
	
	data.push(i)
	return offset+1+length
}

// Extracts a float from the buffer (an Uint8Array) from the position offset to the data Array
// Returns the new offset value or throws in case of error
aP.inflateData.readFloat = function (buffer, offset, data) {
	if (offset+4 > buffer.length)
		throw new Error("Unable to extract float from index "+offset)
	
	data.push(new DataView(buffer.buffer).getFloat32(buffer.byteOffset+offset, true))
	return offset+4
}

// Extracts a token from the buffer (an Uint8Array) from the position offset to the data Array
// Returns the new offset value or throws in case of error
aP.inflateData.readToken = function (buffer, offset, data) {
	if (offset+16 > buffer.length)
		throw new Error("Unable to extract token from index "+offset)
	
	data.push(new aP.Token(buffer.subarray(offset, offset+16)))
	return offset+16
}

// Extracts a string from the buffer (an Uint8Array) from the position offset to the data Array
// Returns the new offset value or throws in case of error
aP.inflateData.readString = function (buffer, offset, data) {
	var length, str, i, c
	
	// Gets the string length
	offset = aP.inflateData.readUint(buffer, offset, data)
	length = data.pop()
	
	if (offset+length > buffer.length)
		throw new Error("Unable to extract string from index "+offset)
	
	// Read from UTF-8 bytes
	str = ""
	for (i=0; i<length; i++) {
		c = buffer[offset+i]
		if (c < 128)
			str += c==0x25 ? "%25" : String.fromCharCode(c)
		else
			str += "%"+c.toString(16).toUpperCase()
	}
	data.push(decodeURIComponent(str))
	
	return offset+length
}

// Extracts a Buffer from the buffer (an Uint8Array) from the position offset to the data Array
// Returns the new offset value or throws in case of error
aP.inflateData.readBuffer = function (buffer, offset, data) {
	var length
	
	// Gets the buffer length
	offset = aP.inflateData.readUint(buffer, offset, data)
	length = data.pop()
	
	if (offset+length > buffer.length)
		throw new Error("Unable to extract Buffer from index "+offset)
	
	data.push(buffer.subarray(offset, offset+length))
	return offset+length
}

// Extracts a boolean from the buffer (an Uint8Array) from the position offset to the data Array
// Returns the new offset value or throws in case of error
aP.inflateData.readBoolean = function (buffer, offset, data) {
	var byte
	
	if (offset+1 > buffer.length)
		throw new Error("Unable to extract boolean from index "+offset)
	
	byte = buffer[offset]
	
	if (byte != 0 && byte != 1)
		throw new Error("Unable to extract boolean from index "+offset)
	
	data.push(Boolean(byte))
	return offset+1
}

// Extracts an array from the buffer (an Uint8Array) from the position offset to the data Array
// format is an Array (or sub-Array) returned by aP.inflateFormat()
// Returns the new offset value or throws in case of error
aP.inflateData.readArray = function (buffer, offset, data, format) {
	var length, i, subdata, array
	
	// Gets the array length
	offset = aP.inflateData.readUint(buffer, offset, data)
	length = data.pop()
	
	// Extracts all elements
	array = []
	for (i=0; i<length; i++) {
		if (format.length == 1)
			offset = aP.inflateData.readElement(buffer, offset, array, format)
		else {
			subdata = []
			offset = aP.inflateData.readElement(buffer, offset, subdata, format)
			array.push(subdata)
		}
	}
	data.push(array)
	
	return offset
}

// Extracts an element from the buffer (an Uint8Array) from the position offset to the data Array
// format is an Array (or sub-Array) returned by aP.inflateFormat()
// Returns the new offset value or throws in case of error
aP.inflateData.readElement = function (buffer, offset, data, format) {
	var i
	for (i=0; i<format.length; i++) {
		if (typeof format[i] == "object")
			offset = aP.inflateData.readArray(buffer, offset, data, format[i])
		else if (format[i] == "u")
			offset = aP.inflateData.readUint(buffer, offset, data)
		else if (format[i] == "i")
			offset = aP.inflateData.readInt(buffer, offset, data)
		else if (format[i] == "f")
			offset = aP.inflateData.readFloat(buffer, offset, data)
		else if (format[i] == "t")
			offset = aP.inflateData.readToken(buffer, offset, data)
		else if (format[i] == "s")
			offset = aP.inflateData.readString(buffer, offset, data)
		else if (format[i] == "B")
			offset = aP.inflateData.readBuffer(buffer, offset, data)
		else
			offset = aP.inflateData.readBoolean(buffer, offset, data)
	}
	return offset
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
