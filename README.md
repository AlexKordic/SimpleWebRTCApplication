# Simple WebRTC application

Basic Requirements:

- Application must be browser based (not necessarily available in all browsers)
- One user must be able to initiate the call to another user (Peer to Peer)
- Video and Audio must be in sync
- Users must be able to Hang-Up calls
- Technologies used must be Node.JS, JavaScript, HTML5
- Code must be clean documented and compatible with best practices
- Code will be compared to online samples and must be demonstrably different and commented

Bonus Requirement:
- Mute, and hide camera buttons
- Ability to locally record the video and audio in MP4 format


### Demo:

[Chrome on Desktop](http://dzeri.com/demio/demio_macbookpro.mp4)

[Chrome Beta on Android](http://dzeri.com/demio/demio_android.mp4)

### Usage:

Initialization:
```Javascript
conference = new ConferenceMachinery(myName, remoteVideo, localVideo);
```
Where ```myName``` is string by which this client will be identified.

Next one needs to register for receiving contact list from server:
```Javascript
conference.events.contactsUpdate.add(function(eventName, contactList) {});
```
In this case ```eventName``` will be ```contactsUpdate```. And ```contactList``` will contain something like:
```Javascript
[{"name": "user1"}, {"name": "user2"}]
```

To initiate call to ```{"name": "user2"}```:
```Javascript
var contact = {"name": "user2"}; // this is suplied from contactsUpdate event
conference.call(contact);
```

To hangup current call:
```Javascript
conference.hangup()
```

To mute/unmute audio:
```Javascript
conference.enableSound(true); // or false
```

To disable/enable video in call:
```Javascript
conference.enableVideo(false); // or true
```


### Internals:


Most of the logic is implemented on browser side. There is no streaming server involved. Node.js server is handling messaging for connected clients, "signaling" in WebRTC jargon. 

Browser will connect to server via WebSocket and send login message with ```peerName``` that user has chosen. On Browser connect and Disconnect list of connected clients is updated and sent to all connected Browsers.

User can click on name in the list to initiate video conference with that peer. 

##

Node.js server is serving static files from ``` browser/ ``` directory. 

Client-side Javascript connects to server via WebSocket. socket.io library is used on server side. 

After initial connection browser will send ```login``` passing ```peerName``` as parameter.

The ```callAttempt``` message is used to initiate call to chosen peer. Server will perform chech if peer is still online and return ```callNow``` message to initiating client and ```expectCall``` message to target peer. ```expectCall``` message is not handled in code, it is just passed to UI for apropriate action, like showing call events.

Signaling is implemented in ```message``` message that is routed by Node.js server.

### Frontend integration:

All logic is encapsulated in ```ConferenceMachinery``` prototype. See usage section for details and ```browser/index.html``` for simplest implementation.

### Database integradtion:

Server only keeps working data in Javascript structures. No persistancy is needed at this requirements stage. 

For expanding data storage logic extend ```Books``` prototype in Node.js sources.


### Status

```
Debuggable     ########
Maintainable   ##########
Understandable ########
Documented     #######
```

### Limitations:

Code uses only default video and audio device, no support for choosing one of available capture devices. So if you have HDMI capture device plugged in your computer it might be used and black video will appear.

Server side code is not using namespace for socket.io.

I have not found method to disconnect socket from server side, I wonder if one can make simple connect DOS attack :(

No exposed state of connection via API.

This code can be optimized to use less network resources.

Implementation supports only 1 to 1 calls at this point.

### References:

This are references to online resources used in past 2 days:

[HTTPS in node.js](https://docs.nodejitsu.com/articles/HTTP/servers/how-to-create-a-HTTPS-server/)

[Setting HTTP headers](https://gist.github.com/balupton/3696140)

[WebRTC start point](https://codelabs.developers.google.com/codelabs/webrtc-web/)

[Object oriented programming in Javascript](http://book.mixu.net/node/ch6.html)

[Recording on browser side](http://stackoverflow.com/a/36783739/70405)

[Utility library for WebRTC compatibility](https://github.com/webrtc/adapter)

[Session Description Protocol](https://en.wikipedia.org/wiki/Session_Description_Protocol)





