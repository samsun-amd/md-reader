const express = require('express');
const cors = require('cors');

const filesRouter = require('./routes/files');
const contentRouter = require('./routes/content');
const uploadRouter = require('./routes/upload');
const configRouter = require('./routes/config');
const { loadConfig } = require('./lib/paths');

const app = express();

// This API can read and write files on disk, so only allow requests from the
// local dev client (and same-origin / non-browser tools that send no Origin).
// Without this, any website you visit could call the API via your browser.
app.use(cors({
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
}));
app.use(express.json({ limit: '20mb' }));

app.use('/api/files', filesRouter);
app.use('/api/content', contentRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/config', configRouter);

const config = loadConfig();
const port = config.port || 3001;
app.listen(port, () => {
  console.log(`MD Reader server running on http://localhost:${port}`);
});
