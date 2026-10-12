const { createApp } = require('./server');
const { resolve } = require('node:path');
const port = Number(process.env.PORT || 3001);
const { server } = createApp({
  dbPath: resolve(process.env.DB_PATH || 'data/analytics.sqlite'),
  projects: (process.env.PROJECT_IDS || 'demo-project').split(',').map(s => s.trim()),
  origins: (process.env.CORS_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port}`).split(',').map(s => s.trim()),
  maxBytes: Number(process.env.MAX_REQUEST_BYTES || 65536),
  maxBatch: Number(process.env.MAX_BATCH_SIZE || 50)
});
server.listen(port, '127.0.0.1', () => console.log(`Demo and API: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
