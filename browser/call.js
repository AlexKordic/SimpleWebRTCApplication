'use strict';


function Call(room_name, remoteVideo, localVideo) {
	var self = this;
	this._started = false;
	this._localStream = false;
	this._isChannelReady = false;
	this._remoteStream = false;
	this._should_i_call = false;
	this.remoteVideo = remoteVideo;
	this.localVideo = localVideo;
	this.room_name = room_name;

	this.socket = io.connect();
	this.socket.emit('create or join', this.room_name);
	this.socket.on("created", function(room) {
		console.log("i created the room so i will call peer");
		self._should_i_call = true;
	})
	this.socket.on("full", function(room) {
		console.log("servers says room is full !");
	})
	this.socket.on("join", function(room) {
		console.log("someone joined your room, he will call you");
		self._isChannelReady = true;
	})
	this.socket.on("joined", function(room) {
		console.log("joined", room);
		self._isChannelReady = true;
	})
	this.socket.on("log", function(array) {
		console.log.apply(console, array);
	})

	this.socket.on("message", this.onMessage.bind(this))

	this.startMyVideo();
}
Call.prototype.startMyVideo = function() {
	var self = this;
	navigator.mediaDevices.getUserMedia({
		audio: false,
		video: true
	}).then(function (stream) {
		// got local stream:
		self.localVideo.src = window.URL.createObjectURL(stream);
		self._localStream = stream;
		self.sendMessage('got user media'); // this is used as we cannot establish connection before acquiring local stream
		if(self._should_i_call) {
			self.start();
		}
	}).catch(function(e) {
		console.log('getUserMedia() error: ' + e.name);
	});
}
Call.prototype.sendMessage = function(message) {
	console.log('Client sending message: ', message);
	this.socket.emit('message', message);
}
Call.prototype.start = function() {
	var self = this;
	console.log("start()", this._started, this._localStream, this._isChannelReady);
	if(this._started === false && this._localStream !== false && this._isChannelReady !== false) {
		try {
			// creating connection
			this.peerConnection = new RTCPeerConnection(null);
			this.peerConnection.onicecandidate = function(event) {
				console.log('icecandidate event: ', event);
				if (event.candidate) {
					self.sendMessage({
						type: 'candidate',
						label: event.candidate.sdpMLineIndex,
						id: event.candidate.sdpMid,
						candidate: event.candidate.candidate
					});
				} else {
					console.log('End of candidates.');
				}
			};
			this.peerConnection.onaddstream = function(event) {
				// setting stream to video element:
				self.remoteVideo.src = window.URL.createObjectURL(event.stream);
				self._remoteStream = event.stream;
			};
			this.peerConnection.onremovestream = function(event) {
				console.log('Remote stream removed. Event: ', event);
				// this will not happen, how to determine call has dropped ??
			};
			console.log('Created RTCPeerConnnection');

			this.peerConnection.addStream(this._localStream);

			this._started = true;

			console.log("am i calling", this._should_i_call);
			if(this._should_i_call) {
				console.log('Sending offer to peer');
				this.peerConnection.createOffer(function(sessionDescription) {
					// Set Opus as the preferred codec in SDP if Opus is present.
					//  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
					self.peerConnection.setLocalDescription(sessionDescription);
					console.log('creating-offer sending message', sessionDescription);
					self.sendMessage(sessionDescription);
				}, function (event) {
					console.log('createOffer() error: ', event);
				});
			}
		} catch(e) {
			console.log("EXCEPTION in start[" + e.message + "]: " + e.sourceURL + ': ' + e.line + "\n" + e.stack);
		}
	}
}
Call.prototype.stop = function(message) {
	this._started = false;
	this.peerConnection.close();
	this.peerConnection = null;
}
Call.prototype.onMessage = function(message) {
	var self = this;
	console.log('Client received message:', message);
	if (message === 'got user media') {
		this.start();
	} else if (message.type === 'offer') {
		if (! this._should_i_call && ! this._started) {
			this.start();
		}
		this.peerConnection.setRemoteDescription(new RTCSessionDescription(message));
		console.log('Sending answer to peer.');
		this.peerConnection.createAnswer().then(
			function(sessionDescription) {
				self.peerConnection.setLocalDescription(sessionDescription);
				console.log('creating-answer sending message', sessionDescription);
				self.sendMessage(sessionDescription);
			}, function (error) {
				console.log('Failed to create session description: ' + error.toString());
			}
		);
	} else if (message.type === 'answer' && this._started) {
		this.peerConnection.setRemoteDescription(new RTCSessionDescription(message));
	} else if (message.type === 'candidate' && this._started) {
		var candidate = new RTCIceCandidate({
			sdpMLineIndex: message.label,
			candidate: message.candidate
		});
		this.peerConnection.addIceCandidate(candidate);
	} else if (message === 'bye' && this._started) {
		console.log('Session terminated.');
		this._should_i_call = false;
		this.stop();
	}

}

// EXTERNAL INTERFACE
Call.prototype.hangup = function() {
	console.log('Hanging up.');
	this.stop();
	this.sendMessage('bye');
}










///////////////////////////////////////////

// Set Opus as the default audio codec if it's present.
function preferOpus(sdp) {
	var sdpLines = sdp.split('\r\n');
	var mLineIndex;
	// Search for m line.
	for (var i = 0; i < sdpLines.length; i++) {
		if (sdpLines[i].search('m=audio') !== -1) {
			mLineIndex = i;
			break;
		}
	}
	if (mLineIndex === null) {
		return sdp;
	}

	// If Opus is available, set it as the default in m line.
	for (i = 0; i < sdpLines.length; i++) {
		if (sdpLines[i].search('opus/48000') !== -1) {
			var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
			if (opusPayload) {
				sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex],
					opusPayload);
			}
			break;
		}
	}

	// Remove CN in m line and sdp.
	sdpLines = removeCN(sdpLines, mLineIndex);

	sdp = sdpLines.join('\r\n');
	return sdp;
}

function extractSdp(sdpLine, pattern) {
	var result = sdpLine.match(pattern);
	return result && result.length === 2 ? result[1] : null;
}

// Set the selected codec to the first in m line.
function setDefaultCodec(mLine, payload) {
	var elements = mLine.split(' ');
	var newLine = [];
	var index = 0;
	for (var i = 0; i < elements.length; i++) {
		if (index === 3) { // Format of media starts from the fourth.
			newLine[index++] = payload; // Put target payload to the first.
		}
		if (elements[i] !== payload) {
			newLine[index++] = elements[i];
		}
	}
	return newLine.join(' ');
}

// Strip CN from sdp before CN constraints is ready.
function removeCN(sdpLines, mLineIndex) {
	var mLineElements = sdpLines[mLineIndex].split(' ');
	// Scan from end for the convenience of removing an item.
	for (var i = sdpLines.length - 1; i >= 0; i--) {
		var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
		if (payload) {
			var cnPos = mLineElements.indexOf(payload);
			if (cnPos !== -1) {
				// Remove CN payload from m line.
				mLineElements.splice(cnPos, 1);
			}
			// Remove CN line in sdp
			sdpLines.splice(i, 1);
		}
	}

	sdpLines[mLineIndex] = mLineElements.join(' ');
	return sdpLines;
}
