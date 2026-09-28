import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import apiRouter from './routes/api.js';
import { getSeasonSummary } from './services/season.js';
import { getGrid } from './services/grid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Data-Source', 'OpenF1 (openf1.org)');
  next();
});

app.use('/api', apiRouter);
app.use(express.static(publicDir, {
  index: 'index.html',
  etag: true,
  lastModified: true,
  maxAge: 0, // revalidate ทุกครั้ง — แก้ไฟล์แล้วรีเฟรชเห็นผลทันที
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use((req, res) => res.status(404).send('Not found'));

app.listen(config.port, config.host, () => {
  console.log(`F1 ZONE server → http://localhost:${config.port}  (season ${config.season})`);
  // อุ่นเครื่อง cache หนัก ๆ ไว้ล่วงหน้า (เรียกครั้งแรกของผู้ใช้จะเร็วขึ้น)
  getSeasonSummary().catch((e) => console.warn('[warmup] season:', e.message));
  getGrid().catch((e) => console.warn('[warmup] grid:', e.message));
});
