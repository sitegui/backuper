// Control the overlay window

"use strict"

var Window = {}

Window.init = function () {
	// Close the window when click outside
	document.getElementById("window-background").addEventListener("click", function (event) {
		if (event.target == event.currentTarget)
			Window.close()
	})
}

// Open the window and show the given title (string)
// Return the window content div element
// onclose() (optional) will be called right after the window is closed (by the user or code)
Window.open = function (title, onclose) {
	if (!Window._closed)
		Window.close()
	document.getElementById("window-background").style.display = ""
	document.getElementById("window-title").textContent = title
	Window._onclose = onclose
	Window._closed = false
	return document.getElementById("window-content")
}

// Close the window
Window.close = function () {
	document.getElementById("window-background").style.display = "none"
	document.getElementById("window-content").innerHTML = ""
	Window._closed = true
	if (Window._onclose)
		Window._onclose()
}

/*
Internals
*/

Window._onclose = null
Window._closed = true
