import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { buildRouter } from './routes.js';

const PORT = Number(process.env['PORT'] ?? 5050);
const RATE_LIMIT_MAX = Number(process.env['REGISTRY_RATE_LIMIT_MAX'] ?? process.env['RATE_LIMIT_MAX'] ?? '60');

const app = express();

app.use(cors());
app.use(express.json());
app.use(rateLimit({
  windowMs: 60_000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } },
}));

app.use('/', buildRouter());

app.listen(PORT, () => {
  console.info(`[skill-registry] Listening on port ${PORT}`);
  console.info(`[skill-registry] Data dir: ${process.env['DATA_DIR'] ?? './data'}`);
  console.info(`[skill-registry] Auth: ${process.env['REGISTRY_AUTH_TOKEN'] ? 'enabled' : 'disabled (no REGISTRY_AUTH_TOKEN set)'}`);
});
