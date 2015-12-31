/* jshint esnext:true */

'use strict';

const path = require('path');
const util = require('util');
const Hapi = require('hapi');
const Boom = require('boom');
const ss = require('socket.io-stream');

const server = new Hapi.Server();
server.connection({
  host: 'localhost',
  port: 7337,
  routes: {
    files: {
      relativeTo: path.join(__dirname, 'public')
    }
  }
});

server.register({
  register: require('hapi-io'),
  options: {
    // socketio: { ... }
  }
}, () => {});

let peerMap = {};
const io = server.plugins['hapi-io'].io;
io.on('connection', function(socket) {
  console.log('peer connected: %s', socket.id);
  socket.on('register', function(peer) {
    console.log('socket %s registered as %s', socket.id, peer.id);
    peerMap[peer.id] = socket.id;
  });
  socket.on('updatePeer', function(id, peer) {
    console.log('%s: update peer: %j', id, peer);
    if (peer.id !== id) {
      let existingSocketId = peerMap[peer.id];
      if (existingSocketId && io.sockets.connected[existingSocketId]) {
        // id already exists
        socket.emit('updatePeerResult', 'Peer id already exists.');
      } else {
        // change peer id
        if (peerMap[id]) {
          delete peerMap[id];
        }
        peerMap[peer.id] = socket.id;
        socket.emit('updatePeerResult');
      }
    }
  });
});

server.register(require('inert'), () => {});

server.route([
  {
    method: 'GET',
    path: '/f/{peerId}/{fileId}',
    handler: function(req, rep) {
      if (req.method == 'HEAD') {
        return rep().header('Accept-Ranges', 'bytes');
      }

      const p = req.params;
      const socketId = peerMap[p.peerId];
      const socket = io.sockets.connected[socketId];

      if (!socket) {
        return rep(Boom.notFound());
      }

      console.log(new Date(), req.headers);
      const m  = /bytes=(\d+)-(\d+)?/i.exec(req.headers.range);
      const range = m && {
        start: +m[1],
        end: isFinite(m[2]) ? 1 + m[2] : undefined
      };

      var reqId = req.id;

      socket.emit('get-file', {
        id: p.fileId,
        reqId: reqId,
        range: range
      });
      // TODO: handle closed connection
      let disconnected = false;
      req.once('disconnect', () => { disconnected = true; });
      ss(socket).once('f-' + reqId, (stream, data) => {
        console.log('got stream: %s %j %s', reqId, data, new Date());

        let onDisconnected = () => {
          console.log('%s: req disconnected %s', reqId, new Date());
          socket.emit('x-' + reqId);
          // TODO: Do we have to close the reply?
        };

        if (disconnected) {
          return onDisconnected();
        }

        req.once('disconnect', onDisconnected);

        let size = 0;
        const t = new Date();
        stream
        .on('data', (chunk) => {
          size += chunk.length;
          // console.log('%s: %d bytes received', reqId, size);
        })
        .once('end', () => {
          let sec = (new Date() - t) / 1000;
          console.log('%s: finished in %d s, avg speed = %d kB/s, %s', reqId,
            sec, size / 1024 / sec, new Date());
        });
        let res = rep(stream);
        res.type(data.type);

        if (range) {
          let end = range.end ? range.end : data.size;
          res.header('Content-Range', util.format('bytes %d-%d/%d', range.start,
            end - 1,
            data.size));
          res.code(206);
          res.bytes(end - range.start);
        } else {
          res.bytes(data.size);
        }

        console.log('%s: streaming %s', reqId, new Date());
        
        return res;
      });
    }
  },
  {
    method: 'GET',
    path: '/{p*}',
    handler: {
      directory: {
        path: '.',
        redirectToSlash: true,
        index: true
      }
    }
  }
]);

server.start((err) => {
  if (err) {
    throw err;
  }

  console.log('Server started:', server.info);
});

