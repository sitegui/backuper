// Load and merge config files

"use strict"

var fs = require("fs")

// Load the config file at the given path
// Return an JSON-like JS object
module.exports = function (path) {
	var config = parse(path)
	
	// Filter out comments
	var filter = function (obj, propName) {
		obj[propName] = obj[propName].value
	}
	
	var sectionName, propName
	for (sectionName in config)
		if (config[sectionName] instanceof Section)
			for (propName in config[sectionName])
				filter(config[sectionName], propName)
		else
			filter(config, sectionName)
	
	return config
}

// Merge the configs in the original file with the ones in the new path
// Save the final result in the new path
// Configs of the original take precedence over the new values
// Configs in the original that are not in the won't be present in the result
module.exports.merge = function (originalPath, newPath) {
	var originalConfig = parse(originalPath, true)
	var newConfig = parse(newPath, true)
	var rows = []
	var sectionName, propName
	
	// Merge the original value with the new into the new obj
	var merge = function (originalObj, newObj, propName) {
		if (originalObj !== undefined && originalObj[propName] !== undefined)
			newObj[propName] = originalObj[propName]
	}
	
	// Stringify the given prop object
	var stringifyProp = function (obj, name) {
		// Comments
		obj.comments.forEach(function (comment) {
			pushRow("# "+comment, false, false)
		})
		
		var value = Array.isArray(obj.value) ? obj.value : [obj.value]
		value.forEach(function (each) {
			pushRow(name+" "+each, false, false)
		})
		
		pushRow("", false, true)
	}
	
	// Put a new row in the file
	// space (bool) indicates whether a blank line should be insert before and after it
	var pushRow = function (str, spaceBefore, spaceAfter) {
		if (spaceBefore && !pushRow._spaced)
			rows.push("")
		if (str)
			rows.push(str)
		if (spaceAfter)
			rows.push("")
		pushRow._spaced = spaceAfter
	}
	pushRow._spaced = true
	
	// Process values without section
	for (propName in newConfig) {
		if (newConfig[propName] instanceof Section)
			continue
		merge(originalConfig, newConfig, propName)
		stringifyProp(newConfig[propName], propName)
	}
	
	// Process sections
	for (sectionName in newConfig)
		if (newConfig[sectionName] instanceof Section) {
			pushRow("["+sectionName+"]", true, true)
			for (propName in newConfig[sectionName]) {
				merge(originalConfig[sectionName], newConfig[sectionName], propName)
				stringifyProp(newConfig[sectionName][propName], propName)
			}
		}
	
	fs.writeFileSync(newPath, rows.join("\r\n"))
}

// Make sure the prop in the given section is an Array
module.exports.insureArray = function (section, propName) {
	if (propName in section) {
		if (!Array.isArray(section[propName]))
			section[propName] = [section[propName]]
	} else
		section[propName] = []
}

// Parse a config file, given its path
// Throw if not found
// raw (bool, optional) indicates whether the values should not be parsed with parseValue (default: false)
function parse(path, raw) {
	var rows, i, row, comments, section, name, value, pos, config
	
	rows = fs.readFileSync(path, {encoding: "utf8"}).split(/\r\n|\n/)
	section = ""
	comments = []
	config = Object.create(Section.prototype)
	
	var saveValue = function (obj) {
		if (name in obj) {
			if (!Array.isArray(obj[name].value))
				obj[name] = {comments: obj[name].comments, value: [obj[name].value]}
			obj[name].comments = obj[name].comments.concat(comments)
			obj[name].value.push(value)
		} else
			obj[name] = {comments: comments, value: value}
	}
	
	for (i=0; i<rows.length; i++) {
		row = rows[i]
		if (!row)
			// Empty row
			;
		else if (row.substr(0, 2) == "# ")
			// Comment row
			comments.push(row.substr(2))
		else if (row[0] == "[" && row[row.length-1] == "]") {
			// Section row
			section = row.substr(1, row.length-2)
			config[section] = Object.create(Section.prototype)
		} else {
			// Config row
			pos = row.indexOf(" ")
			if (pos == -1)
				throw new Error("Invalid config row: "+row)
			name = row.substr(0, pos)
			value = raw ? row.substr(pos+1) : parseValue(row.substr(pos+1))
			saveValue(section ? config[section] : config)
			comments = []
		}
	}
	
	return config
}

// Simply represent a section
function Section(){}

// Return the parsed value
// Valid types:
// strings: "foo"
// regexp: /\.[0-9]/
// bool: true, false
// time: 1ms, 3h, 7min
// numbers
function parseValue(value) {
	var timeUnits = {
		"ms": 1,
		"s": 1e3,
		"min": 60e3,
		"h": 3600e3,
		"d": 24*3600e3,
		"mo": 30.4375*24*3600e3,
		"yr": 365.25*24*3600e3
	}
	var unit
	
	if (value == "true")
		return true
	if (value == "false")
		return false
	if (value[0] == "\"" && value[value.length-1] == "\"")
		// string
		return value.substr(1, value.length-2)
	if (value[0] == "/" && value[value.length-1] == "/")
		// regexp
		return new RegExp(value.substr(1, value.length-2))
	
	for (unit in timeUnits)
		if (value.substr(-unit.length) == unit)
			// time
			return Number(value.substr(0, value.length-unit.length))*timeUnits[unit]
	
	return Number(value)
}
