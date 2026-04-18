import express from 'express';
import cors from 'cors';
import { buildRouter } from './routes.js';

const PORT = Number(process.env['PORT'] ?? 5050);

const app = express();

app.use(cors());
app.use(express.json());

app.use('/', buildRouter());

app.listen(PORT, () => {
  console.info(`[skill-registry] Listening on port ${PORT}`);
  console.info(`[skill-registry] Data dir: ${process.env['DATA_DIR'] ?? './data'}`);
  console.info(`[skill-registry] Auth: ${process.env['REGISTRY_AUTH_TOKEN'] ? 'enabled' : 'disabled (no REGISTRY_AUTH_TOKEN set)'}`);
});
