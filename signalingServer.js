var BROADCAST_ID = '_broadcast_';

// -- create the socket server on the port ---
var srv = require('http').Server();
var io = require('socket.io')(srv);
var port = 9001;
srv.listen(port);
console.log('signaling server started on port:' + port);


// This callback function is called every time a socket
// tries to connect to the server
io.on('connection', function(socket) {

    // ---- multi room ----
    socket.on('enter', function(roomname) {
      socket.join(roomname);
      console.log('id=' + socket.id + ' enter room=' + roomname);
      setRoomname(roomname);
    });

    function setRoomname(room) {
      //// for v0.9
      //socket.set('roomname', room);

      // for v1.0
      socket.roomname = room;
    }

    function getRoomname() {
      var room = null;

      //// for v0.9
      //socket.get('roomname', function(err, _room) {
      //  room = _room;
      //});

      // for v1.0
      room = socket.roomname;

      return room;
    }


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
