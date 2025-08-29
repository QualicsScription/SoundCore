/*
  Minimal Express + Socket.IO signaling server for voice chat rooms
  Domain: intended to be exposed via ngrok CLI using your reserved domain.
  Notes:
  - Run locally: PORT=3000 node server.js
  - The ngrok tunnel is started by scripts/start.(bat|sh). This file no longer auto-starts ngrok.
*/

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const { Server } = require('socket.io');
const dotenv = require('dotenv');

dotenv.config();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: (process.env.CORS_ORIGINS || 'https://hyena-close-purely.ngrok-free.app,http://localhost:3000,http://127.0.0.1:3000').split(','),
  credentials: true
}));

// Serve static client
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (process.env.CORS_ORIGINS || 'https://hyena-close-purely.ngrok-free.app,http://localhost:3000,http://127.0.0.1:3000').split(','),
    methods: ['GET', 'POST']
  }
});

// Room state: roomName -> { socketId: { name } }
const rooms = new Map();

function getPeers(room, exceptId) {
  const r = rooms.get(room) || new Map();
  return [...r.entries()].filter(([id]) => id !== exceptId).map(([id, meta]) => ({ id, name: meta.name || `Peer ${id.slice(0,5)}` }));
}

io.on('connection', (socket) => {
  let joinedRoom = null;
  let displayName = null;

  socket.on('join', ({ room, name }) => {
    joinedRoom = String(room || '').trim();
    displayName = String(name || `User-${socket.id.slice(0,5)}`);
    if (!joinedRoom) return;

    if (!rooms.has(joinedRoom)) rooms.set(joinedRoom, new Map());
    const r = rooms.get(joinedRoom);
    r.set(socket.id, { name: displayName });
    socket.join(joinedRoom);

    socket.emit('joined', { selfId: socket.id, peers: getPeers(joinedRoom, socket.id) });
    socket.to(joinedRoom).emit('new-peer', { id: socket.id, name: displayName });
  });

  socket.on('offer', ({ to, sdp }) => {
    io.to(to).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ to, sdp }) => {
    io.to(to).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('text', ({ message }) => {
    if (!joinedRoom) return;
    io.to(joinedRoom).emit('text', { from: { id: socket.id, name: displayName }, message, timestamp: new Date().toISOString() });
  });

  socket.on('disconnect', () => {
    if (joinedRoom && rooms.has(joinedRoom)) {
      const r = rooms.get(joinedRoom);
      r.delete(socket.id);
      socket.to(joinedRoom).emit('leave', { id: socket.id });
      if (r.size === 0) rooms.delete(joinedRoom);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Signaling server listening on http://${HOST}:${PORT}`);
  console.log('Use scripts/start.bat or start.sh to launch ngrok with your reserved domain.');
});