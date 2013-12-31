/*global aP*/
"use strict"

// Returns an Array representing a data format
aP.inflateFormat = function (format) {
	var i, level, c, child, parent, r
	
	format = format || ""
	
	if (!format.match(/^[uiftsBb()]*$/))
		throw new Error("Invalid format: "+format)
	
	r = []
	r.formatString = format
	level = r
	level.parent = null
	
	for (i=0; i<format.length; i++) {
		c = format[i]
		if (c == "(") {
			child = []
			level.push(child)
			child.parent = level
			level = child
		} else if (c == ")") {
			parent = level.parent
			if (!level.length || !parent)
				throw new Error("Invalid format: "+format)
			delete level.parent
			level = parent
		} else
			level.push(c)
	}
	
	if (level != r)
		throw new Error("Invalid format: "+format)
	
	delete level.parent
	
	return r
}
