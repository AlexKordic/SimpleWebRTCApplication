'use strict';



function ConferenceMachinery(myName, remoteVideo, localVideo) {
	var self = this;
	// true when peerConnection is valid
	this._started = false;
	// our audio and video
	this._localStream = false;
	// we talk only to one peer :)
	this._partnerName = false;
	// partner's audio and video
	this._remoteStream = false;
	// am i initiating side, server has chance to decide on this :)
	this._shouldICall = false;
	// mute state
	this._soundEnabled = true;
	// mute state
	this._videoEnabled = true;

	// reference to video element for streaming manipulation
	this.remoteVideo = remoteVideo;
	// reference to video element for streaming manipulation
	this.localVideo = localVideo;
	// this is our ID, other will call us by this string
	this.myName = myName;

	// register to contents of this map, here we are using jQuery's event system
	this.events = {};

	// single connection, in larger app use namespaces
	this.socket = io.connect();
	
	this.socket.on("connect", function() {
		// send first login on connection
		self.socket.emit('login', self.myName);
	});

	this.socket.on('log', function(array) {
		// comment out if annoyed
		console.log.apply(console, array);
	});

	// pass-trough events:
	this.raiseSocketEvent("loginError");
	this.raiseSocketEvent("loginSuccess");
	this.raiseSocketEvent("contactsUpdate");
	this.raiseSocketEvent("callAttemptUnsuccessful"); // answer to callAttempt
	this.raiseSocketEvent("expectCall"); // propagate to parent for missed call

	// additional events:
	this.events.callBlocked = jQuery.Callbacks("unique");
	this.events.answeringCall = jQuery.Callbacks("unique");
	this.events.mute = jQuery.Callbacks("unique"); // not from server

	// when ordered initiate call
	this.socket.on("callNow", function(contact) {
		console.log("callNow", contact);
		self._partnerName = contact.name;
		self.stop();
		self._shouldICall = true;
		self.start();
	});

	// signaling goes trough here
	this.socket.on("message", this.onMessage.bind(this))

	// init resources:
	this.startMyVideo();
}
ConferenceMachinery.prototype.call = function(contact) {
	// Request permission from server to call this browser
	var contactName = contact.name;
	console.log("call contact", contactName);
	this.socket.emit('callAttempt', contactName);
}
/// Just propagate event to parent [mechanizm]
ConferenceMachinery.prototype.raiseSocketEvent = function(eventName) {
	var self = this;
	self.events[eventName] = jQuery.Callbacks("unique"); // < creating event
	self.socket.on(eventName, function(eventParams) {
		self.raise(eventName, eventParams);
	});
}
/// common point for firing events, it get logged
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
		audio: true,
		video: true
	}).then(function (stream) {
		// got local stream:
		self.localVideo.src = window.URL.createObjectURL(stream);
		self._localStream = stream;
		console.log("initialized my stream");
		if(self._shouldICall) {
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
		// TBD: how to report this error ?
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

			this._resetMute();
			this._started = true;

			console.log("am i calling", this._shouldICall);
			if(this._shouldICall) {
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
			self._shouldICall = false;
			self.start();
			self.raise("answeringCall", peerName);
		}

		if (! this._shouldICall && ! this._started) {
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

	if (message.type === 'muteAudio') {
		console.log("muting peer", message.shouldEnable);
		this.remoteVideo.muted = ! message.shouldEnable; // reverse logic
	} else if (message.type === 'muteVideo') {
		console.log("hiding peer", message.shouldEnable);
		if(message.shouldEnable) {
			// hide video
			this.remoteVideo.style.opacity = 1.0;
		} else {
			// show video
			this.remoteVideo.style.opacity = 0.0;
		}
	} else if (message.type === 'answer' && this._started) {
		console.warn("got answer, peerConnection.setRemoteDescription()");
		this.peerConnection.setRemoteDescription(new RTCSessionDescription(message));
	} else if (message.type === 'candidate' && this._started) {
		var candidate = new RTCIceCandidate({
			sdpMLineIndex: message.label,
			candidate: message.candidate
		});
		this.peerConnection.addIceCandidate(candidate);
	} else if (message === 'hangup' && this._started) {
		console.log('peer terminated session');
		this._shouldICall = false;
		this.stop();
		this.remoteVideo.src = "";
	} else {
		console.error("NOT handling", message);
	}

}

ConferenceMachinery.prototype._resetMute = function() {
	this._soundEnabled = true;
	this._videoEnabled = true;
	this.remoteVideo.muted = false;
	this.remoteVideo.style.opacity = 1.0;
	this.raise("mute", {isAudio: true, state: this._soundEnabled});
	this.raise("mute", {isAudio: false, state: this._videoEnabled});
	this.localVideo.style.opacity = 1.0;
}

// EXTERNAL INTERFACE
ConferenceMachinery.prototype.hangup = function() {
	console.log('Hanging up.');
	this.stop();
	this.remoteVideo.src = "";
	this.sendMessage('hangup');
}
ConferenceMachinery.prototype.isSoundEnabled = function() {
	return this._soundEnabled;
}
ConferenceMachinery.prototype.isVideoEnabled = function() {
	return this._videoEnabled;
}
ConferenceMachinery.prototype.enableSound = function(shouldEnable) {
	this._soundEnabled = shouldEnable;
	this.sendMessage({type: "muteAudio", shouldEnable: shouldEnable})
	this.raise("mute", {isAudio: true, state: shouldEnable})
	// this._enableSoundOrVideo(shouldEnable, true);
}
ConferenceMachinery.prototype.enableVideo = function(shouldEnable) {
	this._videoEnabled = shouldEnable;
	this.sendMessage({type: "muteVideo", shouldEnable: shouldEnable})
	if(shouldEnable) {
		// hide video
		this.localVideo.style.opacity = 1.0;
	} else {
		// show video
		this.localVideo.style.opacity = 0.0;
	}
	this.raise("mute", {isAudio: false, state: shouldEnable})
	// this._enableSoundOrVideo(shouldEnable, false);
}
ConferenceMachinery.prototype._enableSoundOrVideo = function(shouldEnable, isSound) {
	if(isSound) {
		this._soundEnabled = shouldEnable;
	} else {
		this._videoEnabled = shouldEnable;
	} 
	if(this.peerConnection) {
		if(isSound) {
			console.log("enable/disable audio", shouldEnable);
			conference.peerConnection.getLocalStreams()[0].getAudioTracks()[0].enabled = shouldEnable;
		} else {
			console.log("enable/disable video", shouldEnable);
			conference.peerConnection.getLocalStreams()[0].getVideoTracks()[0].enabled = shouldEnable;
		}

		// Bad idea, even if it sounds good on paper:
		// var streams = this.peerConnection.getLocalStreams();
		// for(var streamIndex=0; streamIndex<streams.length; streamIndex) {
		// 	var stream = streams[streamIndex];
		// 	if(stream) {
		// 		var tracks = isSound ? stream.getAudioTracks() : stream.getVideoTracks();
		// 		for(var trackIndex=0; trackIndex<tracks.length; trackIndex++) {
		// 			var track = tracks[trackIndex];
		// 			if(track) {
		// 				track.enabled = shouldEnable;
		// 			}
		// 		}
		// 	}
		// }
	}
	this.raise("mute", {isAudio: isSound, state: shouldEnable})
	console.log("_enableSoundOrVideo() complete");
}









// ///////////////////////////////////////////

// NOT needed at this point:

// // Set Opus as the default audio codec if it's present.
// function preferOpus(sdp) {
// 	var sdpLines = sdp.split('\r\n');
// 	var mLineIndex;
// 	// Search for m line.
// 	for (var i = 0; i < sdpLines.length; i++) {
// 		if (sdpLines[i].search('m=audio') !== -1) {
// 			mLineIndex = i;
// 			break;
// 		}
// 	}
// 	if (mLineIndex === null) {
// 		return sdp;
// 	}

// 	// If Opus is available, set it as the default in m line.
// 	for (i = 0; i < sdpLines.length; i++) {
// 		if (sdpLines[i].search('opus/48000') !== -1) {
// 			var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
// 			if (opusPayload) {
// 				sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex],
// 					opusPayload);
// 			}
// 			break;
// 		}
// 	}

// 	// Remove CN in m line and sdp.
// 	sdpLines = removeCN(sdpLines, mLineIndex);

// 	sdp = sdpLines.join('\r\n');
// 	return sdp;
// }

// function extractSdp(sdpLine, pattern) {
// 	var result = sdpLine.match(pattern);
// 	return result && result.length === 2 ? result[1] : null;
// }

// // Set the selected codec to the first in m line.
// function setDefaultCodec(mLine, payload) {
// 	var elements = mLine.split(' ');
// 	var newLine = [];
// 	var index = 0;
// 	for (var i = 0; i < elements.length; i++) {
// 		if (index === 3) { // Format of media starts from the fourth.
// 			newLine[index++] = payload; // Put target payload to the first.
// 		}
// 		if (elements[i] !== payload) {
// 			newLine[index++] = elements[i];
// 		}
// 	}
// 	return newLine.join(' ');
// }

// // Strip CN from sdp before CN constraints is ready.
// function removeCN(sdpLines, mLineIndex) {
// 	var mLineElements = sdpLines[mLineIndex].split(' ');
// 	// Scan from end for the convenience of removing an item.
// 	for (var i = sdpLines.length - 1; i >= 0; i--) {
// 		var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
// 		if (payload) {
// 			var cnPos = mLineElements.indexOf(payload);
// 			if (cnPos !== -1) {
// 				// Remove CN payload from m line.
// 				mLineElements.splice(cnPos, 1);
// 			}
// 			// Remove CN line in sdp
// 			sdpLines.splice(i, 1);
// 		}
// 	}

// 	sdpLines[mLineIndex] = mLineElements.join(' ');
// 	return sdpLines;
// }
