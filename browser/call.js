'use strict';





function ConferenceMachinery(myName, remoteVideo, localVideo) {
	var self = this;
	this._started = false;
	this._localStream = false;
	this._partnerName = false;
	this._remoteStream = false;
	this._should_i_call = false;
	this.remoteVideo = remoteVideo;
	this.localVideo = localVideo;
	this.myName = myName;

	this.events = {};
	this.socket = io.connect();
	
	this.socket.on("connect", function() {
		// send first login on connection
		self.socket.emit('login', self.myName);
	});

	this.socket.on('log', function(array) {
		console.log.apply(console, array);
	});

	this.raiseSocketEvent("loginError");
	this.raiseSocketEvent("loginSuccess");
	this.raiseSocketEvent("contactsUpdate");
	this.raiseSocketEvent("callAttemptUnsuccessful"); // answer to callAttempt
	this.raiseSocketEvent("expectCall"); // propagate to parent for missed call
	this.events.callBlocked = jQuery.Callbacks("unique");
	this.events.answeringCall = jQuery.Callbacks("unique");

	this.socket.on("callNow", function(contact) {
		console.log("callNow", contact);
		self._partnerName = contact.name;
		self.stop();
		self._should_i_call = true;
		self.start();
	});
	this.socket.on("message", this.onMessage.bind(this))

	this.startMyVideo();
}
ConferenceMachinery.prototype.call = function(contact) {
	var contactName = contact.name;
	console.log("call contact", contactName);
	this.socket.emit('callAttempt', contactName);
}
/// Just propagate event to parent
ConferenceMachinery.prototype.raiseSocketEvent = function(eventName) {
	var self = this;
	self.events[eventName] = jQuery.Callbacks("unique"); // < creating event
	self.socket.on(eventName, function(eventParams) {
		self.raise(eventName, eventParams);
	});
}
ConferenceMachinery.prototype.raise = function(eventName, eventParams) {
	// fire events to parent
	console.log("raising event", eventName, eventParams);
	var callbackBasket = this.events[eventName];
	if (callbackBasket != undefined) {
		callbackBasket.fire(eventName, eventParams); // hm is eventName redundant here ?
	}
}

ConferenceMachinery.prototype.startMyVideo = function() {
	var self = this;
	navigator.mediaDevices.getUserMedia({
		audio: false,
		video: true
	}).then(function (stream) {
		// got local stream:
		self.localVideo.src = window.URL.createObjectURL(stream);
		self._localStream = stream;
		self.sendMessage('got user media'); // this is used as we cannot establish connection before acquiring local stream
		console.log("initialized my stream");
		if(self._should_i_call) {
			console.log("starting after my stream init");
			self.start();
		}
	}).catch(function(e) {
		console.log('getUserMedia() error: ' + e.name);
	});
}
ConferenceMachinery.prototype.sendMessage = function(message, specificPeerName) {
	if(specificPeerName == undefined) {
		// use our conference partner:
		specificPeerName = this._partnerName;
	}
	if(! specificPeerName) {
		console.error("peerName missing !", message);
		return;
		// how to report this error ?
	}
	console.log('I', this.myName, 'SENDING to=', specificPeerName, "msg=", message);
	this.socket.emit('message', specificPeerName, message);
}
ConferenceMachinery.prototype.start = function() {
	var self = this;
	console.log("++ start()", this._started, this._localStream); //, this._isChannelReady);
	if(this._started === false && this._localStream !== false) { //&& this._isChannelReady !== false) {
		try {
			// creating connection
			console.warn("creating peerConnection");
			this.peerConnection = new RTCPeerConnection(null);
			this.peerConnection.onicecandidate = function(event) {
				console.warn('icecandidate event: ', event);
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
				console.warn("adding remote stream", event.stream);
				self.remoteVideo.src = window.URL.createObjectURL(event.stream);
				self._remoteStream = event.stream;
			};
			this.peerConnection.onremovestream = function(event) {
				console.warn('Remote stream removed. Event: ', event);
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
					console.warn('creating-offer sending message', sessionDescription);
					self.sendMessage(sessionDescription);
				}, function (event) {
					console.log('createOffer() error: ', event);
				});
			}
		} catch(e) {
			console.log("EXCEPTION in start[" + e.message + "]: " + e.sourceURL + ': ' + e.line + "\n" + e.stack);
		}
	} else {
		console.log("cant start now.");
	}
}
ConferenceMachinery.prototype.stop = function(message) {
	console.log("stopping remote c", this._started, this.peerConnection);
	this._started = false;
	if(this.peerConnection) {
		this.peerConnection.close();
		this.peerConnection = null;
	}
}
ConferenceMachinery.prototype.alreadyTalking = function() {
	var connected = (
		this.peerConnection != undefined && 
		this.peerConnection.iceConnectionState == "connected");
		// this.peerConnection.connectionState != "disconnected" && 
		// this.peerConnection.connectionState != "failed" && 
		// this.peerConnection.connectionState != "closed");
	// DONE: inspect .signalingState also ? ==> NOT FOR THIS PURPOSE.
	console.log("is talking=", connected);
	return connected;
}
ConferenceMachinery.prototype.onMessage = function(peerName, message) {
	var self = this;
	console.log('onMessage:', message);
	if (message === 'got user media') {
		// this.start();
		console.warn("got user media - return");
		return;
	}

	if (message.type === 'offer') {
		if(peerName != self._partnerName) {
			console.log("new peer name encuntered !");
			// decide to accept call ?
			if(this.alreadyTalking()) {
				console.error("attempted call from", peerName);
				self.raise("callBlocked", peerName);
				return;
			}
			console.warn("preparing to accept call from", peerName);
			self._partnerName = peerName;
			self.stop();
			self._should_i_call = false;
			self.start();
			self.raise("answeringCall", peerName);
		}

		if (! this._should_i_call && ! this._started) {
			this.start();
		}
		console.warn("calling peerConnection.setRemoteDescription()");
		this.peerConnection.setRemoteDescription(new RTCSessionDescription(message));
		console.log('Sending answer to peer.');
		this.peerConnection.createAnswer().then(
			function(sessionDescription) {
				self.peerConnection.setLocalDescription(sessionDescription);
				console.warn('creating-answer sending message', sessionDescription);
				self.sendMessage(sessionDescription);
			}, function (error) {
				console.log('Failed to create session description: ' + error.toString());
			}
		);
		return;
	} 

	if(peerName != self._partnerName) {
		console.error("ignoring message from unknown peer=", peerName, "partner=", self._partnerName);
		return;
	}

	if (message.type === 'answer' && this._started) {
		console.warn("got answer, peerConnection.setRemoteDescription()");
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
	} else {
		console.error("NOT handling", message);
	}

}

// EXTERNAL INTERFACE
ConferenceMachinery.prototype.hangup = function() {
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
