const path = require('path');
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const express = require('express');
const { Server } = require('socket.io');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

function getVersion() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: __dirname }).trim();
  } catch (_e) {
    return Date.now().toString(36);
  }
}

const STATIC_VERSION = getVersion();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  },
  maxHttpBufferSize: 1e8
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const sessions = new Map();

const SESSION_TTL = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.sockets.length === 0 && now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}, 120000);

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get(['/', '/index.html'], (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  html = html
    .replace(/(href|src)="\/([^"?]*\.(css|js|png|ico|svg))/g, `$1="/$2?v=${STATIC_VERSION}`)
    .replace('id="appVersion"></span>', `id="appVersion">v.1.${STATIC_VERSION}</span>`);
  res.type('html').send(html);
});

app.get('/api/session', (req, res) => {
  const id = uuidv4().slice(0, 8).toUpperCase();
  sessions.set(id, {
    id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL,
    sockets: []
  });
  res.json({ id });
});

app.get('/api/sessions/nearby', (_req, res) => {
  const now = Date.now();
  const maxAgeMs = 2 * 60 * 60 * 1000;
  const nearby = [];

  for (const session of sessions.values()) {
    if (now - session.createdAt > maxAgeMs) continue;
    if (session.sockets.length >= 2) continue;
    nearby.push({
      id: session.id,
      peers: session.sockets.length,
      createdAt: session.createdAt
    });
  }

  nearby.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ sessions: nearby.slice(0, 30) });
});

app.get('/api/qr', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Missing text.' });
    }

    const dataUrl = await QRCode.toDataURL(text, {
      width: 220,
      margin: 1,
      color: { dark: '#0f5f54', light: '#ffffff' }
    });

    return res.json({ dataUrl });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to generate QR.' });
  }
});

app.post('/api/upload/:sessionId', upload.single('file'), (req, res) => {
  const sessionId = req.params.sessionId?.toUpperCase();
  const session = sessions.get(sessionId);
  if (!session || !req.file) {
    return res.status(400).json({ error: 'Invalid session or file.' });
  }

  io.to(sessionId).emit('relay:file', {
    name: req.file.originalname,
    type: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    payload: req.file.buffer.toString('base64')
  });

  return res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.on('session:join', (sessionIdRaw, ack) => {
    const sessionId = String(sessionIdRaw || '').toUpperCase().trim();
    if (!sessionId) {
      ack?.({ ok: false, error: 'Missing session code.' });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      ack?.({ ok: false, error: 'Session not found.' });
      return;
    }

    session.sockets = session.sockets.filter((id) => io.sockets.sockets.has(id));

    if (session.sockets.length >= 2 && !session.sockets.includes(socket.id)) {
      ack?.({ ok: false, error: 'Session already has two devices.' });
      return;
    }

    if (!session.sockets.includes(socket.id)) {
      session.sockets.push(socket.id);
    }

    socket.join(sessionId);
    socket.data.sessionId = sessionId;

    const peers = session.sockets.filter((id) => id !== socket.id);
    ack?.({ ok: true, peers });
    socket.to(sessionId).emit('peer:joined', socket.id);
  });

  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('relay:text', ({ sessionId, text }) => {
    if (!sessionId || typeof text !== 'string') {
      return;
    }
    socket.to(sessionId).emit('relay:text', { text, from: socket.id });
  });

  socket.on('relay:file', ({ sessionId, file }) => {
    if (!sessionId || !file) {
      return;
    }
    socket.to(sessionId).emit('relay:file', file);
  });

  socket.on('relay:file-offer', ({ sessionId, offer }) => {
    if (!sessionId || !offer) {
      return;
    }
    socket.to(sessionId).emit('relay:file-offer', offer);
  });

  socket.on('relay:file-request', ({ sessionId, id }) => {
    if (!sessionId || !id) {
      return;
    }
    socket.to(sessionId).emit('relay:file-request', { id, from: socket.id });
  });

  socket.on('relay:file-error', ({ sessionId, id }) => {
    if (!sessionId || !id) return;
    socket.to(sessionId).emit('relay:file-error', { id });
  });

  socket.on('relay:file-start', ({ sessionId, meta }) => {
    if (!sessionId || !meta?.id) {
      return;
    }
    socket.to(sessionId).emit('relay:file-start', meta);
  });

  socket.on('relay:file-chunk', ({ sessionId, chunk }) => {
    if (!sessionId || !chunk?.id || typeof chunk.payload !== 'string') {
      return;
    }
    socket.to(sessionId).emit('relay:file-chunk', chunk);
  });

  socket.on('history:request', ({ sessionId }) => {
    if (!sessionId) return;
    socket.to(sessionId).emit('history:request', { from: socket.id });
  });

  socket.on('history:sync', ({ sessionId, messages }) => {
    if (!sessionId) return;
    socket.to(sessionId).emit('history:sync', { messages });
  });

  socket.on('disconnect', () => {
    const { sessionId } = socket.data;
    if (!sessionId || !sessions.has(sessionId)) {
      return;
    }

    const session = sessions.get(sessionId);
    session.sockets = session.sockets.filter((id) => id !== socket.id);

    socket.to(sessionId).emit('peer:left');

    if (session.sockets.length === 0) {
      session.expiresAt = Date.now() + SESSION_TTL;
    }
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`Quick Chat running at http://0.0.0.0:${port}`);
});
