/*global aP, _port*/

"use strict"

var CC_GET_UPLOADER_STATUS = aP.registerClientCall(100, "", "s")
var CC_GET_TREE = aP.registerClientCall(101, "", "s")
var SC_UPLOADER_PROGRESS = aP.registerServerCall(100, "suuu")

var _conn = new aP("ws://localhost:"+_port)
_conn.onopen = function () {
	_conn.sendCall(CC_GET_UPLOADER_STATUS, null, function (str) {
		console.log(JSON.parse(str))
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
