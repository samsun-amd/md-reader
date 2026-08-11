const express = require('express');
const cors = require('cors');

const filesRouter = require('./routes/files');
const contentRouter = require('./routes/content');
const uploadRouter = require('./routes/upload');
const configRouter = require('./routes/config');
const { loadConfig } = require('./lib/paths');

const app = express();

const config = loadConfig();
const allowRemoteAccess = config.allowRemoteAccess === true;
const readOnly = config.readOnly === true;

// This API can read and write files on disk. By default only the local dev
// client (and same-origin / non-browser tools that send no Origin) may call it,
// so a random website you visit can't drive the API via your browser. When
// allowRemoteAccess is on, the service is meant for trusted-network/VPN testing,
// so all origins are accepted.
const corsOptions = allowRemoteAccess
  ? { origin: true }
  : {
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        try {
          const { hostname } = new URL(origin);
          if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
            return cb(null, true);
          }
        } catch { /* fall through to denial */ }
        return cb(new Error('Not allowed by CORS'));
      },
    };
app.use(cors(corsOptions));
app.use(express.json({ limit: '20mb' }));

// Read-only mode: reject every mutating request before it reaches a route, so
// even a direct API caller can't write. Method-based so it covers all current
// and future write endpoints.
//
// Two exemptions, both navigation-only — neither can alter a document:
//   - POST /config/reload        re-reads config.json from disk, no side effects
//   - {POST,DELETE} .../pins     bookmarks a folder you can already browse
// Read-only protects documents, and a pin is not a document. Note this does let
// anyone who can reach the server change the pin list, which matters when
// allowRemoteAccess binds 0.0.0.0 with no auth.
const PINS_RE = /^\/config\/roots\/[^/]+\/pins$/;
if (readOnly) {
  const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  app.use('/api', (req, res, next) => {
    const isReload = req.method === 'POST' && req.path === '/config/reload';
    const isPin = (req.method === 'POST' || req.method === 'DELETE') && PINS_RE.test(req.path);
    if (WRITE_METHODS.has(req.method) && !isReload && !isPin) {
      return res.status(403).json({ error: 'Server is in read-only mode' });
    }
    return next();
  });
}

app.use('/api/files', filesRouter);
app.use('/api/content', contentRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/config', configRouter);

const port = config.port || 3001;
const host = allowRemoteAccess ? '0.0.0.0' : '127.0.0.1';
app.listen(port, host, () => {
  const ro = readOnly ? ' [read-only]' : '';
  if (allowRemoteAccess) {
    console.log(`MD Reader server running on http://0.0.0.0:${port} (remote access enabled)${ro}`);
  } else {
    console.log(`MD Reader server running on http://localhost:${port}${ro}`);
  }
});
