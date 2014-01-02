/*global aP*/
"use strict"

// Creates a new aP.Data object to store encoded data in the protocol format
aP.Data = function () {
	this.buffer = new aP.DataBuffer
	this.format = ""
}

// Transform a aP.Data, aP.DataArray, string, null or undefined into a aP.Data object
aP.Data.toData = function (x) {
	var data
	if (x instanceof aP.Data)
		return x
	else {
		data = new aP.Data
		if (x instanceof aP.DataArray)
			data.addDataArray(x)
		else if (typeof x == "string")
			data.addString(x)
		else if (typeof x == "boolean")
			data.addBoolean(x)
		else if (x !== null && x !== undefined)
			throw new TypeError("Invalid type to convert to coded Buffer")
		return data
	}
}

// Appends a unsigned integer to the data
aP.Data.prototype.addUint = function (u) {
	// Validates the input
	if (Math.round(u) != u || u > aP.Data.MAX_DOUBLE_INT || u < 0)
		throw new TypeError("Unsigned integer expected")
	
	// First byte
	if (u <= aP.Data.MAX_UINT_1_B) {
		this.buffer.append(aP.Data.OFFSET_1_B+(u&aP.Data.MASK_7_B))
		u = 0
	} else if (u <= aP.Data.MAX_UINT_2_B) {
		this.buffer.append(aP.Data.OFFSET_2_B+(u&aP.Data.MASK_6_B))
		u >>= 6
	} else if (u <= aP.Data.MAX_UINT_3_B) {
		this.buffer.append(aP.Data.OFFSET_3_B+(u&aP.Data.MASK_5_B))
		u >>= 5
	} else if (u <= aP.Data.MAX_UINT_4_B) {
		this.buffer.append(aP.Data.OFFSET_4_B+(u&aP.Data.MASK_4_B))
		u >>= 4
	} else if (u <= aP.Data.MAX_UINT_5_B) {
		this.buffer.append(aP.Data.OFFSET_5_B+(u>aP.Data.MAX_INT ? u%_POWS2[3] : u&aP.Data.MASK_3_B))
		u = u>aP.Data.MAX_INT ? Math.floor(u/8) : u>>3
	} else if (u <= aP.Data.MAX_UINT_6_B) {
		this.buffer.append(aP.Data.OFFSET_6_B+(u%_POWS2[2]))
		u = Math.floor(u/4)
	} else if (u <= aP.Data.MAX_UINT_7_B) {
		this.buffer.append(aP.Data.OFFSET_7_B+(u%_POWS2[1]))
		u = Math.floor(u/2)
	} else {
		this.buffer.append(aP.Data.OFFSET_8_B)
	}
	
	// Other bytes
	while (u) {
		this.buffer.append(u>aP.Data.MAX_INT ? u%_POWS2[8] : u&aP.Data.MASK_8_B)
		u = u>aP.Data.MAX_INT ? Math.floor(u/256) : u>>8
	}
	
	this.format += "u"
	return this
}

// Appends a signed integer to the data
aP.Data.prototype.addInt = function (i) {
	var length
	
	// Validates the input
	if (Math.round(i) != i || Math.abs(i) >= -aP.Data.MIN_INT_7_B)
		throw new TypeError("Signed integer expected")
	
	// First byte
	if (i >= aP.Data.MIN_INT_1_B && i < -aP.Data.MIN_INT_1_B) {
		i -= aP.Data.MIN_INT_1_B
		this.buffer.append(aP.Data.OFFSET_1_B+(i&aP.Data.MASK_7_B))
		i = 0
		length = 0
	} else if (i >= aP.Data.MIN_INT_2_B && i < -aP.Data.MIN_INT_2_B) {
		i -= aP.Data.MIN_INT_2_B
		this.buffer.append(aP.Data.OFFSET_2_B+(i&aP.Data.MASK_6_B))
		i >>= 6
		length = 1
	} else if (i >= aP.Data.MIN_INT_3_B && i < -aP.Data.MIN_INT_3_B) {
		i -= aP.Data.MIN_INT_3_B
		this.buffer.append(aP.Data.OFFSET_3_B+(i&aP.Data.MASK_5_B))
		i >>= 5
		length = 2
	} else if (i >= aP.Data.MIN_INT_4_B && i < -aP.Data.MIN_INT_4_B) {
		i -= aP.Data.MIN_INT_4_B
		this.buffer.append(aP.Data.OFFSET_4_B+(i&aP.Data.MASK_4_B))
		i >>= 4
		length = 3
	} else if (i >= aP.Data.MIN_INT_5_B && i < -aP.Data.MIN_INT_5_B) {
		i -= aP.Data.MIN_INT_5_B
		this.buffer.append(aP.Data.OFFSET_5_B+(i > aP.Data.MAX_INT ? i%_POWS2[3] : i&aP.Data.MASK_3_B))
		i = i > aP.Data.MAX_INT ? Math.floor(i/8) : i>>3
		length = 4
	} else if (i >= aP.Data.MIN_INT_6_B && i < -aP.Data.MIN_INT_6_B) {
		i -= aP.Data.MIN_INT_6_B
		this.buffer.append(aP.Data.OFFSET_6_B+(i%_POWS2[2]))
		i = Math.floor(i/4)
		length = 5
	} else {
		i -= aP.Data.MIN_INT_7_B
		this.buffer.append(aP.Data.OFFSET_7_B+(i%_POWS2[1]))
		i = Math.floor(i/2)
		length = 6
	}
	
	// Other bytes
	while (length--) {
		this.buffer.append(i>aP.Data.MAX_INT ? i%_POWS2[8] : i&aP.Data.MASK_8_B)
		i = i>aP.Data.MAX_INT ? Math.floor(i/256) : i>>8
	}
	
	this.format += "i"
	return this
}

// Appends a float to the data
aP.Data.prototype.addFloat = function (f) {
	var buffer = new DataView(new ArrayBuffer(4))
	buffer.setFloat32(0, f, true)
	this.buffer.append(new Uint8Array(buffer.buffer))
	this.format += "f"
	return this
}

// Appends a aP.Token to the data
aP.Data.prototype.addToken = function (t) {
	this.buffer.append(t.buffer)
	this.format += "t"
	return this
}

// Appends a string to the data
aP.Data.prototype.addString = function (s) {
	var buffer, i, format, h, j
	
	// Extract to UTF-8 bytes
	buffer = new aP.DataBuffer
	for (i=0; i<s.length; i++) {
		if (s.charCodeAt(i) < 128)
			buffer.append(s.charCodeAt(i))
		else {
			h = encodeURIComponent(s.charAt(i)).substr(1).split("%")
			for (j=0; j<h.length; j++)
				buffer.append(parseInt(h[j], 16))
		}
	}
	
	format = this.format
	this.addUint(buffer.length)
	this.buffer.append(buffer)
	this.format = format+"s"
	return this
}

// Appends a aP.DataArray to the data
aP.Data.prototype.addDataArray = function (a) {
	var format = this.format
	this.addUint(a.length)
	this.buffer.append(a.buffer)
	this.format = format+"("+a.format+")"
	return this
}

// Appends another aP.Data to this
aP.Data.prototype.addData = function (data) {
	this.buffer.append(data.buffer)
	this.format += data.format
	return this
}

// Appends a Buffer to the data
aP.Data.prototype.addBuffer = function (B) {
	var format = this.format
	this.addUint(B.length)
	this.buffer.append(B)
	this.format = format+"B"
	return this
}

// Appends a boolean to the data
aP.Data.prototype.addBoolean = function (b) {
	this.buffer.append(b ? 1 : 0)
	this.format += "b"
	return this
}

// Appends an Array of unsigned integer
aP.Data.prototype.addUintArray = function (array) {
	var i, format = this.format
	this.addUint(array.length)
	for (i=0; i<array.length; i++)
		this.addUint(array[i])
	this.format = format+"(u)"
	return this
}

// Appends an Array of signed integer
aP.Data.prototype.addIntArray = function (array) {
	var i, format = this.format
	this.addUint(array.length)
	for (i=0; i<array.length; i++)
		this.addInt(array[i])
	this.format = format+"(i)"
	return this
}

// Appends an Array of float
aP.Data.prototype.addFloatArray = function (array) {
	var i, format = this.format
	this.addUint(array.length)
	for (i=0; i<array.length; i++)
		this.addFloat(array[i])
	this.format = format+"(f)"
	return this
}

// Appends an Array of aP.Token
aP.Data.prototype.addTokenArray = function (array) {
	var i, format = this.format
	this.addUint(array.length)
	for (i=0; i<array.length; i++)
		this.addToken(array[i])
	this.format = format+"(t)"
	return this
}

// Appends an Array of string
aP.Data.prototype.addStringArray = function (array) {
	var i, format = this.format
	this.addUint(array.length)
	for (i=0; i<array.length; i++)
		this.addString(array[i])
	this.format = format+"(s)"
	return this
}

// Appends an Array of Buffer
aP.Data.prototype.addBufferArray = function (array) {
	var i, format = this.format
	this.addUint(array.length)
	for (i=0; i<array.length; i++)
		this.addBuffer(array[i])
	this.format = format+"(B)"
	return this
}

// Appends an Array of boolean
aP.Data.prototype.addBooleanArray = function (array) {
	var i, format = this.format
	this.addUint(array.length)
	for (i=0; i<array.length; i++)
		this.addBoolean(array[i])
	this.format = format+"(b)"
	return this
}

// Returns a Uint8Array with all the data stored
aP.Data.prototype.toBuffer = function () {
	return this.buffer.buffer.subarray(0, this.buffer.length)
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
aP.Data.MAX_DOUBLE_INT = _POWS2[53]-1
aP.Data.MAX_INT = _POWS2[31]-1
aP.Data.MAX_UINT_1_B = _POWS2[7]-1
aP.Data.MAX_UINT_2_B = _POWS2[14]-1
aP.Data.MAX_UINT_3_B = _POWS2[21]-1
aP.Data.MAX_UINT_4_B = _POWS2[28]-1
aP.Data.MAX_UINT_5_B = _POWS2[35]-1
aP.Data.MAX_UINT_6_B = _POWS2[42]-1
aP.Data.MAX_UINT_7_B = _POWS2[49]-1
aP.Data.MIN_INT_1_B = -_POWS2[6]
aP.Data.MIN_INT_2_B = -_POWS2[13]
aP.Data.MIN_INT_3_B = -_POWS2[20]
aP.Data.MIN_INT_4_B = -_POWS2[27]
aP.Data.MIN_INT_5_B = -_POWS2[34]
aP.Data.MIN_INT_6_B = -_POWS2[41]
aP.Data.MIN_INT_7_B = -_POWS2[48]
aP.Data.OFFSET_1_B = 0
aP.Data.OFFSET_2_B = _POWS2[7]
aP.Data.OFFSET_3_B = _POWS2[7]+_POWS2[6]
aP.Data.OFFSET_4_B = _POWS2[7]+_POWS2[6]+_POWS2[5]
aP.Data.OFFSET_5_B = _POWS2[7]+_POWS2[6]+_POWS2[5]+_POWS2[4]
aP.Data.OFFSET_6_B = _POWS2[7]+_POWS2[6]+_POWS2[5]+_POWS2[4]+_POWS2[3]
aP.Data.OFFSET_7_B = _POWS2[7]+_POWS2[6]+_POWS2[5]+_POWS2[4]+_POWS2[3]+_POWS2[2]
aP.Data.OFFSET_8_B = _POWS2[7]+_POWS2[6]+_POWS2[5]+_POWS2[4]+_POWS2[3]+_POWS2[2]+_POWS2[1]
aP.Data.MASK_1_B = _POWS2[0]
aP.Data.MASK_2_B = _POWS2[0]+_POWS2[1]
aP.Data.MASK_3_B = _POWS2[0]+_POWS2[1]+_POWS2[2]
aP.Data.MASK_4_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]
aP.Data.MASK_5_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]+_POWS2[4]
aP.Data.MASK_6_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]+_POWS2[4]+_POWS2[5]
aP.Data.MASK_7_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]+_POWS2[4]+_POWS2[5]+_POWS2[6]
aP.Data.MASK_8_B = _POWS2[0]+_POWS2[1]+_POWS2[2]+_POWS2[3]+_POWS2[4]+_POWS2[5]+_POWS2[6]+_POWS2[7]
