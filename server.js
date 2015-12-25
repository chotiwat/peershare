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

const io = server.plugins['hapi-io'].io;
io.on('connection', function(socket) {
  console.log('peer connected: %s', socket.id);
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
      const socket = io.sockets.connected[p.peerId];

      if (!socket) {
        return rep(Boom.notFound());
      }

      console.log(req.headers);
      const m  = /bytes=(\d+)-(\d+)?/i.exec(req.headers.range);
      const range = m && {
        start: +m[1],
        end: isFinite(m[2]) ? 1 + m[2] : undefined
      };

      socket.emit('get-file', {
        id: p.fileId,
        reqId: req.id,
        range: range
      });
      // TODO: handle closed connection
      let disconnected = false;
      req.once('disconnect', () => { disconnected = true; });
      ss(socket).once('f-' + req.id, (stream, data) => {
        console.log('got stream: %s', req.id, data);

        let onDisconnected = () => {
          console.log('%s: req disconnected', req.id);
          socket.emit('x-' + req.id);
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
          // console.log('%s: %d bytes received', req.id, size);
        })
        .once('end', () => {
          let sec = (new Date() - t) / 1000;
          console.log('%s: finished in %d s, avg speed = %d kB/s', req.id,
            sec, size / 1024 / sec);
        });
        let res = rep(stream);
        if (range) {
          res.header('Content-Range', util.format('bytes %d-%d/%d', range.start,
            (range.end ? range.end : data.size) - 1,
            data.size));
        }
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

