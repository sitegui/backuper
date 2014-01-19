"use strict"

// Create a new counter
// callback will be executed after the n-th call to counter.tick()
function Counter(num, callback) {
	if (num) {
		this.num = num
		this.callback = callback
		this.i = 0
	} else
		process.nextTick(callback)
}

module.exports = Counter

// Next tick (don't call this more than "num" times)
Counter.prototype.tick = function () {
	this.i++
	if (this.i === this.num)
		process.nextTick(this.callback)
}
