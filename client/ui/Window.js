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
Window.open = function (title) {
	document.getElementById("window-background").style.display = ""
	document.getElementById("window-title").textContent = title
	return document.getElementById("window-content")
}

// Close the window
Window.close = function () {
	document.getElementById("window-background").style.display = "none"
	document.getElementById("window-content").innerHTML = ""
}
