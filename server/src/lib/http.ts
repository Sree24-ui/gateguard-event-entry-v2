import type { NextFunction, Request, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { z, ZodError } from 'zod';
import { config, isProd, isTest } from '../config.js';
import { Audit, Event, User, type EventDoc, type Role, type UserDoc } from '../models.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Per-IP (or custom key) rate limiter with the API's error shape. In-memory: per server instance. */
export const limiter = (windowMs: number, limit: number, message: string, extra: Partial<Options> = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: { code: 'rate_limited', message } },
    ...extra,
  });

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);

export const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

// ---- sessions ----
export const SESSION_COOKIE = 'gg_session';

export function setSession(res: Response, user: { _id: unknown }) {
  const token = jwt.sign({ sub: String(user._id) }, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: config.sessionHours * 3600_000,
    path: '/',
  });
}

declare global {
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

/** Loads the user from the session cookie on every request — disabling an account takes effect immediately. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  let sub: string;
  try {
    sub = (jwt.verify(token, config.jwtSecret) as { sub: string }).sub;
  } catch {
    throw new HttpError(401, 'unauthenticated', 'Session expired — sign in again');
  }
  const user = await User.findById(sub).lean<UserDoc>();
  if (!user || user.disabled) throw new HttpError(401, 'unauthenticated', 'Account unavailable');
  req.user = user;
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role as Role)) {
      throw new HttpError(403, 'forbidden', 'Your role does not allow this action');
    }
    next();
  };

/** Mongo filter for events the user can see: admins all, organizers own, operators assigned. */
export function eventScope(user: UserDoc) {
  if (user.role === 'admin') return {};
  if (user.role === 'organizer') return { $or: [{ ownerId: user._id }, { staff: user._id }] };
  return { staff: user._id };
}

/**
 * Loads an event the user may access. `manage` = may edit event/attendees (owner organizer or admin);
 * otherwise assigned staff may read stats and scan.
 */
export async function loadEvent(user: UserDoc, id: string, mode: 'read' | 'manage' = 'read'): Promise<EventDoc> {
  if (!mongoose.isValidObjectId(id)) throw notFound('Event');
  const event = await Event.findOne({ _id: id, ...eventScope(user) }).lean<EventDoc>();
  if (!event) throw notFound('Event');
  if (mode === 'manage' && user.role !== 'admin' && !event.ownerId.equals(user._id)) {
    throw new HttpError(403, 'forbidden', 'Only the event organizer can change this event');
  }
  return event;
}

export function audit(actor: UserDoc | undefined, action: string, extra: { eventId?: mongoose.Types.ObjectId; target?: string; details?: unknown } = {}) {
  return Audit.create({ actorId: actor?._id, action, ...extra });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    const fields = Object.fromEntries(err.issues.map((i) => [i.path.join('.') || '_', i.message]));
    return res.status(400).json({ error: { code: 'validation', message: 'Please check the highlighted fields', fields } });
  }
  if ((err as { code?: number })?.code === 11000) {
    return res.status(409).json({ error: { code: 'conflict', message: 'That record already exists' } });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Malformed JSON body' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side' } });
}
