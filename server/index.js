var aP = require("async-protocol")
var net = require("net")

net.createServer(function (conn) {
    conn = new aP(conn)
    conn.on("call", function (type, data, answer) {
    })
}).listen(8001)
