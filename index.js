'use strict';

var os = require('os');
var fs = require('fs');
var nodeStatic = require('node-static');
var https = require('https');
var socketIO = require('socket.io');



var httpsOptions = {
	key: fs.readFileSync ('certificate/test.key'),
	cert: fs.readFileSync('certificate/test.pem')
};

var fileServer = new(nodeStatic.Server)("./browser");
var app = https.createServer(httpsOptions, function(req, res) {
	// res.setHeader('Access-Control-Allow-Origin', '*');
	fileServer.serve(req, res);
}).listen(8080);

var io = socketIO.listen(app);


function Books() {
	this.rooms = {};
}
Books.prototype.participants = function(name) {
	var participants = this.rooms[name];
	if(participants == undefined) return [];
	return participants.slice();
}
Books.prototype.addBrowserToRoom = function(browser, name) {
	var participants = this.rooms[name];
	if(participants == undefined) {
		// Create room if it does not exist
		participants = [];
		this.rooms[name] = participants;
	}
	participants.push(browser)
}
Books.prototype.removeBrowserFromRoom = function(browser, name) {
	var participants = this.rooms[name];
	if(participants == undefined) return;
	var index = participants.indexOf(browser);
	if(index !== -1) {
		participants.splice(index, 1);
	}
}

var _books = new Books();


// TODO: put in its own file
function Browser(socket) {
	this.socket = socket
	this.room_name = null;
}
Browser.prototype.log = function() {
	var array = ['Message from server:'];
	array.push.apply(array, arguments);
	this.socket.emit('log', array);
}
Browser.prototype.join_room = function(room) {
	this.log('Received request to create or join room ' + room);

	// var numClients = io.sockets.sockets.length;
	// this.log('Room ' + room + ' now has ' + numClients + ' client(s)');
	var peers = _books.participants(room);

	if(peers.length > 1) {
		socket.emit('full', room);
		return;
	}

	_books.addBrowserToRoom(this, room);
	this.log('Room ' + room + ' now has ' + (peers.length +1) + ' client(s)');
	this.room_name = room;

	// emit join
	if (peers.length > 0) {
		var i;
		for(i=0; i<peers.length; i++) {
			var peer = peers[i];
			peer.socket.emit("join", room);
		}
		this.socket.emit('joined', room, this.socket.id);
	} else {
		this.socket.emit('created', room, this.socket.id);
	}
}
Browser.prototype.send_message_to_peers = function(message) {
	this.log('Client said: ', message);
	var participants = _books.participants(this.room_name);
	var i;
	for(i=0; i<participants.length; i++) {
		var peer = participants[i];
		if(peer === this) continue;
		peer.socket.emit("message", message);
	}
}
Browser.prototype.send_ip_addressess = function() {
	// TODO: maybe address of peer are required here ? or this address ?
	// TODO: why are we sending server ip address here ?? makes no sense ! 
	var ifaces = os.networkInterfaces();
	for (var dev in ifaces) {
		ifaces[dev].forEach(function(details) {
			if (details.family === 'IPv4' && details.address !== '127.0.0.1') {
				this.socket.emit('ipaddr', details.address);
			}
		});
	}
}
Browser.prototype.disconnected = function() {
	_books.removeBrowserFromRoom(this, this.room_name);
	// notify peers about this ?? or not ??
}



io.sockets.on('connection', function(socket) {
	var browser = new Browser(socket);
	// var address = socket.handshake.address;
	var address = socket.request.connection.remoteAddress;
	console.log("new connection " + address);

	socket.on('message', browser.send_message_to_peers.bind(browser));
	socket.on('create or join', browser.join_room.bind(browser));
	socket.on('ipaddr', browser.send_ip_addressess.bind(browser));
	socket.on('bye', function(){
		console.log('received bye');
	});
	socket.on('disconnect', function () {
		console.log('disconnect from', address);
		browser.disconnected();
	})
});

