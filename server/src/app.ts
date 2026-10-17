import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config } from './config.js';
import { connectDb } from './db.js';
import { errorHandler, HttpError, limiter } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { eventsRouter } from './routes/events.js';
import { publicRouter } from './routes/public.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));

  // CORS only for explicitly allow-listed origins (the production app is same-origin and needs none).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE',
        Vary: 'Origin',
      });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '600kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.get('/health', async (_req, res) => {
    let db = 'down';
    try {
      await connectDb();
      await mongoose.connection.db!.admin().ping();
      db = 'up';
    } catch {
      /* reported below */
    }
    res.status(db === 'up' ? 200 : 503).json({ ok: db === 'up', service: 'gateguard-v2-api', db, time: new Date() });
  });
  api.use(limiter(60_000, 600, 'Too many requests. Slow down for a moment.'));
  api.use(async (_req, _res, next) => {
    await connectDb();
    next();
  });
  api.use(authRouter, publicRouter, eventsRouter);
  api.use(() => {
    throw new HttpError(404, 'not_found', 'No such API route');
  });

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
