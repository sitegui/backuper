/*global aP, _port, FilesExplorer*/

"use strict"

var CC_GET_UPLOADER_STATUS = aP.registerClientCall(100, "", "s")
var CC_GET_TREE = aP.registerClientCall(101, "", "s")
var CC_GET_WATCHED_FOLDERS = aP.registerClientCall(102, "", "(s)")
var CC_ADD_WATCH_FOLDER = aP.registerClientCall(103, "s", "(s)")
var CC_REMOVE_WATCH_FOLDER = aP.registerClientCall(104, "s", "(s)")
var SC_UPLOADER_PROGRESS = aP.registerServerCall(100, "suuu")

var _conn = new aP("ws://localhost:"+_port)
_conn.onopen = function () {
	_conn.sendCall(CC_GET_UPLOADER_STATUS, null, function (str) {
		console.log(JSON.parse(str))
	})
	_conn.sendCall(CC_GET_TREE, null, function (str) {
		FilesExplorer.setTree(JSON.parse(str))
	})
	_conn.oncall = function (type, data, answer) {
		if (type == SC_UPLOADER_PROGRESS) {
			document.getElementById("out").textContent = JSON.stringify(data)
			answer()
		}
	}
}
_conn.onclose = function () {
	console.log("closed")
}

window.onload = function () {
	FilesExplorer.init(get("files-path"), get("files-stage"))
}

function get(id) {
	return document.getElementById(id)
}
