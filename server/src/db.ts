import mongoose from 'mongoose';
import { config } from './config.js';

let connecting: Promise<typeof mongoose> | undefined;

/** One shared connection per process (serverless instances reuse it across requests). */
export function connectDb(uri = config.mongoUri) {
  if (!connecting) {
    connecting = mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 }).catch((err) => {
      connecting = undefined;
      throw err;
    });
  }
  return connecting;
}
