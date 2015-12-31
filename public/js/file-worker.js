importScripts(
  '../bower_components/socket.io-client/socket.io.js',
  'socket.io-stream.js'
);

console.log('eee');

var socket;
var files = {};
var peer;

var handlers = {
  init: function(args) {
    console.log('init:', args);
    peer = args[0];
    socket = io('http://localhost:7337');
    // handle connection and reconnection
    socket.on('connect', function() {
      console.log('connect');
      socket.emit('register', peer);
    });
    socket.on('get-file', function(data) {
      var file = files[data.id];
      console.log('get-file', data, file);

      postMessage(['trackRequest', data]);

      var stream = ss.createStream({ highWaterMark: 1024000 });
      ss(socket).emit('f-' + data.reqId, stream, {
        size: file.size,
        type: file.type
      });

      var end = (data.range && isFinite(data.range.end)) ? data.range.end : file.size;
      var blob = data.range ? file.slice(data.range.start, end) : file;
      var size = 0;
      console.log('%s: uploading %d bytes', data.id, blob.size);

      var t = new Date();
      var interval = setInterval(function() {
        // postMessage(['updateSpeed', data.reqId, ]);
        postMessage(['progress', data.reqId, {
          speed: size * 1000 / 1024 / (new Date() - t),
          size: size / blob.size
        }]);
      }, 1000);

      function untrackRequest() {
        clearInterval(interval);
        postMessage(['untrackRequest', data.reqId]);
      }

      socket.once('x-' + data.reqId, function() {
        console.log('%s: aborted', data.id);
        stream.end();
        untrackRequest();
      });

      ss.createBlobReadStream(blob, { highWaterMark: 1024000 })
      .on('data', function(chunk) {
        // update progress
        size += chunk.length;
        // console.log('%s: %d bytes (%d%%) uploaded', data.id, size, size / blob.size * 100);
      })
      .on('end', function() {
        console.log('%s: end', data.id);
        untrackRequest();
      })
      .on('error', function(err) {
        console.error('%s:', data.id, err);
        untrackRequest();
      })
      .on('close', function() {
        console.log('%s: closed', data.id);
        untrackRequest();
      })
      .pipe(stream);
      console.log('%s: stream started', data.id);

    });
  },
  updatePeer: function(args, callback) {
    console.log('updatePeer:', args);
    var newPeer = args[0];
    socket.emit('updatePeer', peer.id, newPeer);
    socket.once('updatePeerResult', function(err) {
      if (!err) {
        peer = newPeer;
      }
      callback(err, newPeer);
    });
  },
  updateFiles: function(args) {
    files = args[0];
  }
};

onmessage = function(e) {
  console.log('file-worker onmessage', e);
  var method = e.data.shift();
  var handler = handlers[method];
  if (handler) {
    handler(e.data, function() {
      var results = Array.prototype.slice.call(arguments);
      results.unshift(method);
      postMessage(results);
    });
  }
};

console.log('xxx');