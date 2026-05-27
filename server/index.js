const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const filesRouter = require('./routes/files');
const contentRouter = require('./routes/content');

function loadConfig() {
  const cfgPath = path.join(__dirname, '../config.json');
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/files', filesRouter);
app.use('/api/content', contentRouter);

const config = loadConfig();
const port = config.port || 3001;
app.listen(port, () => {
  console.log(`MD Reader server running on http://localhost:${port}`);
});
