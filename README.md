# webRTCでvideo配信

配信者の音声と動画が受信者に一斉配信されるためのプログラム



## webRTCの基本 (シグナリングはSDPとICEの交換)

webRTCのシグナリング

引用) https://qiita.com/massie_g/items/f5baf316652bbc6fcef1

> WebRTCでは、Peer-to-Peer通信を始める前に、お互いの情報を交換するための[シグナリング](http://html5experts.jp/mganeko/5181/)と呼ばれる処理があります。その過程で2種類の情報をやり取りします。
>
> SDP: Peerの情報
>
> ICE Candidate: 通信経路の情報
>
> 通常はこの2つは異なるイベントをトリガーにしてやり取りします。
>
> - SDPの送信： **PeerConnection.createOffer() / PeerConnection.createAnswer()** のコールバック （1回ずつ）
> - ICE Candidateの送信： **PeerConnection.onicecandidate()** イベントハンドラ （複数回）



![signaling](https://qiita-user-contents.imgix.net/https%3A%2F%2Fqiita-image-store.s3.amazonaws.com%2F0%2F19403%2Fc28174c1-d2db-7f9d-251d-4e14a5335e84.png?ixlib=rb-1.2.2&auto=format&gif-q=60&q=75&w=1400&fit=max&s=d19c35757aa686c9b46a7bea09b3f9d1)

- Peer Aから**pc.createOffer()**で生成された Offer SDP をPeer Bに送信
- Peer Bでは、**pc.createAnswer()**で Answer SDP を生成し、Peer Aに返信
- それぞれのPeerで、**pc.onicecandidate()**イベントハンドラに渡されたICE Candidateを、相手に送信（複数回）

```
sdp: "v=0 o=- 3336702409326257609 2 IN IP4 127.0.0.1 ...以下略... "
type: "offer"  // <-- または "answer" 
```



> この sdp の部分の文字列が、実際のPeerの情報です。
>
> これを相手に送るのですが、同時に**PeerConnection.setLocalDescription()**に渡して自分でも覚えます。
>
> 覚えたsdpの値は次の属性値として取得することができます。



つまり、

- setLocalDescription() : 自分のPeerの情報を覚えておく

  ```
  PeerConnection.localDescription.sdp
  ```

- setRemoteDescription() : 相手のPeerの情報を覚えておく

  ```
  PeerConnection.remoteDescription.sdp
  ```

  

  

# talk.html

## シグナリングサーバとsocket.ioで接続

**シグナリングサーバーに対して、socket.ioクライアントを使って接続しておきます。**

また、接続時（会議室への入室）、切断時、メッセージ受信時の**イベントハンドラを設定**します。

```javascript
// create socket
  var socketReady = false;
  var port = 9001;
  var socket = io.connect('http://localhost:' + port + '/');
```

```javascript
// socket: channel connected
  socket.on('connect', onOpened)
        .on('message', onMessage)
        .on('user disconnected', onUserDisconnect);
```



イベントハンドラの登録

```javascript
  function onOpened(evt) {
    socketReady = true;
    var roomname = getRoomName(); // 会議室名を取得する
    socket.emit('enter', roomname);
  }
```

```js
function getRoomName() { // たとえば、 URLに  ?roomname  とする
    var url = document.location.href;
    var args = url.split('?');
    if (args.length > 1) {
      var room = args[1];
      if (room != "") {
        return room;
      }
    }
    return "_defaultroom";
  }
```



```javascript
function onUserDisconnect(evt) {
    if (evt) {
      stopConnection(evt.id);
    }
  }
```

```javascript
 // socket: accept connection request
  function onMessage(evt) {
    var id = evt.from;
    var target = evt.sendto;
    var conn = getConnection(id);

    if (evt.type === 'talk_request') {
      if (! isLocalStreamStarted()) {
        console.warn('local stream not started. ignore request');
        return;
      }
      console.log("receive request, start offer.");
      sendOffer(id);
      return;
    }
      
    else if (evt.type === 'answer' && isPeerStarted()) {
      console.log('Received answer, settinng answer SDP');
      onAnswer(evt);
        
    } else if (evt.type === 'candidate' && isPeerStarted()) {
      console.log('Received ICE candidate...');
      onCandidate(evt);
    }
      
    else if (evt.type === 'bye') {
      console.log("got bye.");
      stopConnection(id);
    }
  }
```

```javascript
  function stopConnection(id) {
    var conn = connections[id];
    if(conn) {
      conn.peerconnection.close();
      conn.peerconnection = null;
      delete connections[id];
    }
  }
```



## シグナリング

### OfferSDP and ICECandidate

if (evt.type === 'talk_request')のとき

Offerを作って相手に送る、Candidateを相手に送る

- sendOffer

- createOffer

- peer = new webkitRTCPeerConnection(pc_config);

- sdp = sessionDescription

- candidate = {type: "candidate",
                            sendto: conn.id,
                            sdpMLineIndex: evt.candidate.sdpMLineIndex,
                            sdpMid: evt.candidate.sdpMid,
                            candidate: evt.candidate.candidate}

- **sendSDP(sdp)**

- **sendCandidate(candidate);**



function sendOffer

```javascript
  function sendOffer(id) {
    var conn = getConnection(id);
    if (!conn) {
      conn = prepareNewConnection(id);
    }

    conn.peerconnection.createOffer(function (sessionDescription) { // in case of success
      conn.peerconnection.setLocalDescription(sessionDescription);
      sessionDescription.sendto = id;
      sendSDP(sessionDescription);
    }, function () { // in case of error
      console.log("Create Offer failed");
    }, mediaConstraints);
  }
```



function prepareConnection

```javascript
  function prepareNewConnection(id) {
    var pc_config = {"iceServers":[]};
    var peer = null;
    try {
      peer = new webkitRTCPeerConnection(pc_config);
    } catch (e) {
      console.log("Failed to create PeerConnection, exception: " + e.message);
    }
    var conn = new Connection();
    conn.id = id;
    conn.peerconnection = peer;
    peer.id = id;
    addConnection(id, conn);

    // send any ice candidates to the other peer
    peer.onicecandidate = function (evt) {
      if (evt.candidate) {
        // sendCandidate(candidate)
        sendCandidate({type: "candidate",
                          sendto: conn.id,
                          sdpMLineIndex: evt.candidate.sdpMLineIndex,
                          sdpMid: evt.candidate.sdpMid,
                          candidate: evt.candidate.candidate});
      } else {
        console.log("ICE event. phase=" + evt.eventPhase);
      }
    };
      
    peer.addStream(localStream);

    return conn;
  }
```



function sendCandidate

```javascript
  function sendCandidate(candidate) {
    var text = JSON.stringify(candidate);
    // send via socket
    socket.json.send(candidate);
  }
```



function sendSDP

```js
function sendSDP(sdp) {
    var text = JSON.stringify(sdp);
    console.log("---sending sdp text ---");
    console.log(text);

    // send via socket
    socket.json.send(sdp);
  }
```

```javascript
  function isPeerStarted() {
    if (getConnectionCount() > 0) {
      return true;
    }
    else {
      return false;
    }
  }
```



### answerSDPの受け取り

else if (evt.type === 'answer' && isPeerStarted())

```javascript
function onAnswer(evt) {
    console.log("Received Answer...")
    console.log(evt);
    setAnswer(evt);
  }
```

```js
function setAnswer(evt) {
 var id = evt.from;
    var conn = getConnection(id);
    if (! conn) {
   console.error('peerConnection not exist!');
   return
    }
    conn.peerconnection.setRemoteDescription(new RTCSessionDescription(evt));
  }
```



### ICECandidateの受け取り

else if (evt.type === 'candidate' && isPeerStarted())

```javascript
  function onCandidate(evt) {
   var id = evt.from;
    var conn = getConnection(id);
    if (! conn) {
      console.error('peerConnection not exist!');
      return;
    }
    var candidate = new RTCIceCandidate({sdpMLineIndex:evt.sdpMLineIndex, sdpMid:evt.sdpMid, candidate:evt.candidate});
    console.log("Received Candidate...")
    conn.peerconnection.addIceCandidate(candidate);
  }
```



### 切断

else if (evt.type === 'bye')

```javascript
function stopConnection(id) {
    var conn = connections[id];
    if(conn) {
      console.log('stop and delete connection with id=' + id);
      conn.peerconnection.close();
      conn.peerconnection = null;
      delete connections[id];
    }
    else {
      console.log('try to stop connection, but not found id=' + id);
    }
  }
```



## getUserMedia

Webブラウザでカメラ映像、マイク音声を取得するためには、`getUserMedia`というブラウザ標準APIを利用します。

`getUserMedia`で取得した`stream`オブジェクト（自分のカメラ映像）を、先程のvideo要素にセットしています。

```html
<script>
  let localStream;

  // カメラ映像取得
  navigator.mediaDevices.getUserMedia({video: true, audio: true})
    .then( stream => {
    // 成功時にvideo要素にカメラ映像をセットし、再生
    const videoElm = document.getElementById('my-video')
    videoElm.srcObject = stream;
    videoElm.play();
    // 着信時に相手にカメラ映像を返せるように、グローバル変数に保存しておく
    localStream = stream;
  }).catch( error => {
    // 失敗時にはエラーログを出力
    console.error('mediaDevice.getUserMedia() error:', error);
    return;
  });
</script>
```



### Start video ボタン

```javascript
<button type="button" onclick="startVideo();">Start video</button>  

function startVideo() {

var constraints = { audio: true, video: { width: 1280, height: 720 } };

navigator.mediaDevices.getUserMedia(constraints)
  .then(function(stream) {
    localStream = stream;
    var video = document.querySelector('#local-video');
    video.srcObject = stream;
    video.onloadedmetadata = function(e) {
      video.play();
      tellReady();
    };
  })
  .catch(function(err) {
    console.log(err.name + ": " + err.message);
  });
  }
```



### Stop video ボタン

```javascript
<button type="button" onclick="stopVideo();">Stop video</button>
  &nbsp;&nbsp;&nbsp;&nbsp;

function stopVideo() {
    hangUp();

    // localVideo.src = "";
    // localStream.stop();
    localStream = null;
  }
```



### On Air ボタン

```javascript
<button type="button" onclick="tellReady();">On Air</button>

function tellReady() {
    if (! isLocalStreamStarted()) {
      alert("Local stream not running yet. Please [Start Video] or [Start Screen].");
      return;
    }
    if (! socketReady) {
      alert("Socket is not connected to server. Please reload and try again.");
      return;
    }
    // call others, in same room
    console.log("tell ready to others in same room, befeore offer");
    socket.json.send({type: "talk_ready"});
  }
```

```javascript
var localVideo = document.getElementById('local-video');
  var localStream = null;
  var mediaConstraints = {'mandatory': {'OfferToReceiveAudio':false, 'OfferToReceiveVideo':false }};
```

```javascript
function isLocalStreamStarted() {
    if (localStream) {
      return true;
    }
    else {
      return false;
    }
  }
```

```javascript
// socket: channel connected
  socket.on('connect', onOpened)
        .on('message', onMessage)
        .on('user disconnected', onUserDisconnect);

  function onOpened(evt) {
    console.log('socket opened.');
    socketReady = true;

    var roomname = getRoomName(); // 会議室名を取得する
    socket.emit('enter', roomname);
    console.log('enter to ' + roomname);
  }
```



# signalingServer.js

```javascript
// -- create the socket server on the port ---
var srv = require('http').Server();
var io = require('socket.io')(srv);
var port = 9001;
srv.listen(port);
```



### roomname

`enter`という処理を受け取る。受け取ったデータはroomnameである。

>上記コード内に以下のコードを追加してRoomを初期化。
>
>```js
>socket.join('<Room ID>');
>```
>
>メッセージ配信時に特定のRoomにのみ配信を行うためにRoom ID指定したioでemitする。
>
>```js
>io.to('<Room ID>').emit('chat message', msg);
>```
>
>参考) https://qiita.com/ynunokawa/items/564757fe6dbe43d172f8



### userID

> Socket.IOでアクセスしたクライアントには必ず一意のIDが割り当てられます。このIDを利用することで、特定のクライアントに対してのみサーバからデータを送信できます。個別送信では、「io.to(ID).emit(送信イベント名, 送信データ)」を使用します。
>
> ```js
> console.log('id=' + socket.id + ' enter room=' + roomname);
> ```
>
> 参考) https://www.atmarkit.co.jp/ait/articles/1604/27/news026_3.html



io.on()

```javascript
io.on('connection', function(socket) {
    // ---- multi room ----
    socket.on('enter', function(roomname) {
      socket.join(roomname);
      console.log('id=' + socket.id + ' enter room=' + roomname);
      setRoomname(roomname);
    });

    function setRoomname(room) {
      socket.roomname = room;
    }
```



function emitMessage(type, message)

```js
function getRoomname() {
      var room = null;
      room = socket.roomname;
      return room;
    }
```

```js
function emitMessage(type, message) {
      // ----- multi room ----
      var roomname = getRoomname();

      if (roomname) {
        console.log('===== message broadcast to room -->' + roomname);
        socket.broadcast.to(roomname).emit(type, message);
      }
      else {
        console.log('===== message broadcast all');
        socket.broadcast.emit(type, message);
      }
    }
```



socket.on()

```js
    // When a user send a SDP message
    // broadcast to all users in the room
    socket.on('message', function(message) {
        message.from = socket.id;
        // get send target
        var target = message.sendto;
        if ( (target) && (target != BROADCAST_ID) ) {
          console.log('===== message emit to -->' + target);
          socket.to(target).emit('message', message);
          return;
        }
        // broadcast in room
        emitMessage('message', message);
    });

    // When the user hangs up
    // broadcast bye signal to all users in the room
    socket.on('disconnect', function() {
        console.log('-- user disconnect: ' + socket.id);
        // --- emit ----
        emitMessage('user disconnected', {id: socket.id});

        // --- leave room --
        var roomname = getRoomname();
        if (roomname) {
          socket.leave(roomname);
        }
    });
});
```



# watch.html

## シグナリングサーバとsocket.ioで接続

```js
var socketReady = false;
  var port = 9001;
  var socket = io.connect('http://localhost:' + port + '/'); // ※自分のシグナリングサーバーに合わせて変更してください

  // socket: channel connected
  socket.on('connect', onOpened)
        .on('message', onMessage)
        .on('user disconnected', onUserDisconnect);

```

```js
function onOpened(evt) {
    console.log('socket opened.');
    socketReady = true;

    var roomname = getRoomName(); // 会議室名を取得する
    socket.emit('enter', roomname);
    console.log('enter to ' + roomname);
  }
```

```js
function onUserDisconnect(evt) {
    console.log("disconnected");
    if (evt) {
      detachVideo(evt.id); // force detach video
      stopConnection(evt.id);
    }
  }
```

```js
  // socket: accept connection request
  function onMessage(evt) {
    var id = evt.from;
    var target = evt.sendto;
    var conn = getConnection(id);

    console.log('onMessage() evt.type='+ evt.type);

    if (evt.type === 'talk_ready') {
      if (conn) {
        return;  // already connected
      }

      if (isConnectPossible()) {
        socket.json.send({type: "talk_request", sendto: id });
      }
      else {
        console.warn('max connections. so ignore call');
      }
      return;
    }
    else if (evt.type === 'offer') {
      console.log("Received offer, set offer, sending answer....")
      onOffer(evt);
    }
    else if (evt.type === 'candidate' && isPeerStarted()) {
      console.log('Received ICE candidate...');
      onCandidate(evt);
    }
    else if (evt.type === 'end_talk') {
      console.log("got talker bye.");
      detachVideo(id); // force detach video
      stopConnection(id);
    }

  }
```



## シグナリング

### OfferSDPを受け取る and AnswerSDPを送る

else if (evt.type === 'offer')

```js
function onOffer(evt) {
    console.log("Received offer...")
    console.log(evt);
    setOffer(evt);
    sendAnswer(evt);
  }
```

setRemoteDescription()

```js
function setOffer(evt) {
    var id = evt.from;
    var conn = getConnection(id);
    if (! conn) {
      conn = prepareNewConnection(id);
      conn.peerconnection.setRemoteDescription(new RTCSessionDescription(evt));
    }
    else {
      console.error('peerConnection alreay exist!');
    }
  }
```

answerSDP

```js
function sendAnswer(evt) {
    console.log('sending Answer. Creating remote session description...' );
    var id = evt.from;
    var conn = getConnection(id);
    if (! conn) {
      console.error('peerConnection not exist!');
      return;
    }

    conn.peerconnection.createAnswer(function (sessionDescription) {
      // in case of success
      conn.peerconnection.setLocalDescription(sessionDescription);
      sessionDescription.sendto = id;
      sendSDP(sessionDescription);
    }, function () { // in case of error
      console.log("Create Answer failed");
    }, mediaConstraints);
  }
```



### ICECandidateの受け取り

else if (evt.type === 'candidate' && isPeerStarted())

```js
function onCandidate(evt) {
    var id = evt.from;
    var conn = getConnection(id);
    if (! conn) {
       console.error('peerConnection not exist!');
       return;
    }

    var candidate = new RTCIceCandidate({sdpMLineIndex:evt.sdpMLineIndex, sdpMid:evt.sdpMid, candidate:evt.candidate});
    console.log("Received Candidate...")
    console.log(candidate);
    conn.peerconnection.addIceCandidate(candidate);
  }
```



## Request ボタン

```
<button type="button" onclick="sendRequest();">Request</button>
```

```js
function sendRequest() {
    if (! socketReady) {
      alert("Socket is not connected to server. Please reload and try again.");
      return;
    }

    // call others, in same room
    console.log("send request in same room, ask for offer");
    socket.json.send({type: "talk_request"});
  }
```



## videoを受け取る

```
<video id="remote-video" autoplay style="width: 320px; height: 240px; border: 1px solid black;"></video>
```

```js
var remoteVideo = document.getElementById('remote-video');
var mediaConstraints = {'mandatory': {'OfferToReceiveAudio':true, 'OfferToReceiveVideo':true }};
```



peer.addEventListener

```js
// talk.html
peer.addStream(localStream);
```

```js
// watch.html
peer.addEventListener("addstream", onRemoteStreamAdded, false);
```



onRemoteStreamAdded

```js
// watch.html
function onRemoteStreamAdded(event) {
      console.log("Added remote stream");
      // #== 参考にさせていただいたサイトのプログラム ==#
      //attachVideo(this.id, event.stream);
      // remoteVideo.src = window.webkitURL.createObjectURL(event.stream);
      var video = document.querySelector('#remote-video');
      video.srcObject = event.stream;
    }
```



# 余談 : datachannel (WebSocket もどき)

## なぜ、もうひとつdata channelが必要？

すでに[WebSocket](http://www.html5rocks.com/en/tutorials/websockets/basics/)、[AJAX](http://www.html5rocks.com/en/tutorials/file/xhr2/)、[Server Sent Events](http://www.html5rocks.com/en/tutorials/eventsource/basics/)があります。なぜ、もう一つのコミュニケーションchannelが必要なのでしょうか？ WebSocketは双方向ですが、これら全ての技術はサーバとの送受信を目的として設計されています。

RTCDataChannelの異なるアプローチ：

- ピアツーピア間の接続を可能にするRTCPeerConnection APIと連携して動きます。これにより、レイテンシを低くすることができます。なぜならば、中継サーバが無く、中継するホップも少ないためです。
- RTCDataChannelは[Stream Control Transmission Protocol](https://en.wikipedia.org/wiki/Stream_Control_Transmission_Protocol#Features) (SCTP)を利用しており、転送方式を変更可能です：つまり、順序を考慮しない方式、順序を考慮して再送制御する方式を設定可能となります。

WebRTCはピアツーピア間のコミュニケーションを可能にしますが、サーバは依然として必要です：

- **シグナリング：**ピア接続を確立するために、メディアやネットワークのメタ情報の交換が必要です。
- **NATとファイアウォールの対処**：ICEフレームワークの活用によりピア間の最適な経路を確立できます。ICEフレームワークは、STUNサーバ（ピア間で接続可能な外部に公開されているIPとポートの確認）とTURN（ピア間の直接の接続が失敗した場合には、データの中継が必要）と連動して動作します。



**RTCDataChannel APIは、柔軟なデータ形式をサポートしています。APIはWebSocketをそっくり真似るように設計されています。**



## Data Channelの作り方

RTCDataChannelのシンプルなオンラインデモがあります：

- [simpl.info/dc](http://simpl.info/dc)
- [webrtc.github.io/samples/src/content/datachannel/basic](http://webrtc.github.io/samples/src/content/datachannel/basic/) (SCTPまたはRTP)
- [webrtc.github.io/samples/src/content/datachannel/filetransfer/](http://webrtc.github.io/samples/src/content/datachannel/filetransfer/)
- [pubnub.github.io/webrtc](http://pubnub.github.io/webrtc) (２つのPubNubクライアント間で)

これらのケースでは、ブラウザが自身にピア接続を作ります。その後、**Data Channelを作成し、ピア接続に応じてメッセージを送信します。**

そして、最後にはもう一方の欄にメッセージが表示されます！

```js
var peerConnection = new RTCPeerConnection();

var dataChannel =
  peerConnection.createDataChannel("myLabel", dataChannelOptions);

dataChannel.onerror = function (error) {
  console.log("Data Channel Error:", error);
};

dataChannel.onmessage = function (event) {
  console.log("Got Data Channel Message:", event.data);
};

dataChannel.onopen = function () {
  dataChannel.send("Hello World!");
};

dataChannel.onclose = function () {
  console.log("The Data Channel is Closed");
};
```



**dataChannelオブジェクトは、既に確立しているピア接続から作られます。**

このオブジェクトは、シグナリングが起こる前後に作られます。ラベルを用いて、他のチャネル間と識別して、設定(省略可能)を行います。

```js
var dataChannelOptions = {
  ordered: false, // 順序を保証しない
  maxRetransmitTime: 3000, // ミリ秒
};
```

- **ordered:** 順序を保証するか、しないか
- **maxRetransmitTime:** 送信に失敗したメッセージの最大再送時間(信頼性の無いモード)
- **maxRetransmits:** 送信に失敗したメッセージの最大再送回数(信頼性の無いモード)



**WebSocketと同様に、接続が確立された場合・閉じた場合・エラーが起きた場合・他方のピアからメッセージを受信した場合に、RTCDataChannelはイベントを起こします。**

参考) https://www.html5rocks.com/ja/tutorials/webrtc/datachannels/



# 実行



```bash
# install
$ sudo apt install nodejs npm
```

```bash
# make package
# -y : skip all question
$ npm init -y
```

I used [this page](https://qiita.com/righteous/items/e5448cb2e7e11ab7d477) as reference

```bash
# -s : package.json の dependencies欄 にパッケージ名が記録
$ npm install -s socket.io
```

```bash
$ node signalingServer.js
```



