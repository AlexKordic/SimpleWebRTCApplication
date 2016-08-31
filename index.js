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
	this.peers = {};
}
Books.prototype.exist = function(name) {
	return this.peers[name];
}
Books.prototype.participants = function() {
	var ret = [];
	for(var name in this.peers) {
		if(this.peers.hasOwnProperty(name))
			ret.push(this.peers[name]);
	}
	return ret;
}
Books.prototype.contactList = function() {
	var ret = []
	var participants = this.participants();
	for(var i=0; i<participants.length; i++) {
		var browser = participants[i];
		ret.push(browser.toContact());
	}
	return ret;
}
Books.prototype.addBrowserToBooks = function(browser) {
	this.peers[browser.myName] = browser;
}
Books.prototype.removeBrowserFromBooks = function(browser) {
	var recordsShow = this.peers[browser.myName];
	if( recordsShow === browser ) {
		delete this.peers[browser.myName];
	} else {
		console.log("removeBrowserFromBooks data inconsistent", recordsShow, browser);
	}
}

var _books = new Books();


// TODO: put in its own file
function Browser(socket) {
	this.socket = socket
	this.myName = "unknown";
}
Browser.prototype.log = function() {
	var array = ['Message from server:'];
	array.push.apply(array, arguments);
	this.socket.emit('log', array);
	console.log.apply(console, array);
}
Browser.prototype.toContact = function() {
	return {
		name: this.myName
	}
}
Browser.prototype.sendContactList = function() {
	// refresh contact list on all connected browsers - not using broadcast
	var contactList = _books.contactList();
	console.log("new contactList", contactList);
	var participants = _books.participants();
	for(var i=0; i<participants.length; i++) {
		var browser = participants[i];
		console.log("sending contactsUpdate to", browser.myName);
		browser.socket.emit("contactsUpdate", contactList);
	}
}
Browser.prototype.login = function(peerName) {
	this.log('Logging on with name ' + peerName);
	this.myName = peerName;

	var existing = _books.exist(peerName);
	if(existing != undefined && existing !== this) {
		this.socket.emit('loginError', "name already taken");
		return;
	}
	this.socket.emit('loginSuccess', peerName);

	_books.addBrowserToBooks(this);
	this.sendContactList();
}
Browser.prototype.callAttempt = function(peerName) {
	if(peerName == this.myName) {
		this.socket.emit("callAttemptUnsuccessful", "forbidden to call yourself");
		return;
	}
	var peerBrowser = _books.exist(peerName);
	if(! peerBrowser) {
		console.log("requested peer not online", peerName, peerBrowser);
		this.socket.emit("callAttemptUnsuccessful", "peer not online");
		return;
	}
	console.log("connecting", this.myName, peerBrowser.myName);
	peerBrowser.socket.emit("expectCall", this.toContact());
	this.socket.emit("callNow", peerBrowser.toContact());
}
Browser.prototype.sendMessageToPeer = function(peerName, message) {
	// this.log('MESSAGING from=', this.myName, '    to=', peerName, "msg=", message);
	var peerBrowser = _books.exist(peerName);
	if(peerBrowser) {
		peerBrowser.socket.emit("message", this.myName, message);
	}
}
Browser.prototype.sendIpAddressess = function() {
	// TODO: maybe address of peer are required here ? or this address ?
	// TODO: why are we sending server ip address here ?? makes no sense ! 
	console.log("sendIpAddressess !");
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
	_books.removeBrowserFromBooks(this);
	this.sendContactList();
}



io.sockets.on('connection', function(socket) {
	var browser = new Browser(socket);
	// var address = socket.handshake.address;
	var address = socket.request.connection.remoteAddress;
	console.log("new connection " + address);

	socket.on('message', browser.sendMessageToPeer.bind(browser));
	// socket.on('create or join', browser.join_room.bind(browser));
	socket.on('login', browser.login.bind(browser));
	socket.on('callAttempt', browser.callAttempt.bind(browser));


	socket.on('ipaddr', browser.sendIpAddressess.bind(browser));
	socket.on('bye', function(){
		console.log('received bye');
	});
	socket.on('disconnect', function () {
		console.log('disconnect from', address);
		browser.disconnected();
	})
});

