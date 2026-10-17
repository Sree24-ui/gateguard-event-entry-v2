import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { audit, HttpError, limiter, notFound, objectId, requireAuth, requireRole, SESSION_COOKIE, setSession } from '../lib/http.js';
import { ROLES, User, type UserDoc } from '../models.js';

export const authRouter = Router();

const publicUser = (u: UserDoc) => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  role: u.role,
  disabled: u.disabled,
  isDemo: u.isDemo,
});

// Compared against when the email doesn't exist so response time doesn't reveal valid accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const loginLimiter = limiter(15 * 60_000, 20, 'Too many sign-in attempts. Try again in a few minutes.');

authRouter.post('/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = z
    .object({ email: z.email('Enter a valid email').toLowerCase(), password: z.string().min(1, 'Enter your password').max(200) })
    .parse(req.body);
  const user = await User.findOne({ email }).lean<UserDoc>();
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.disabled) {
    await audit(undefined, 'auth.login_failed', { target: email });
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  setSession(res, user);
  await audit(user, 'auth.login');
  res.json({ user: publicUser(user) });
});

authRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Signed-out is a normal state for this endpoint, so it answers 200 with user: null rather than 401.
authRouter.get('/auth/me', (req, res, next) => {
  if (!req.cookies?.[SESSION_COOKIE]) return res.json({ user: null });
  return requireAuth(req, res, next);
}, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

const password = z.string().min(10, 'Use at least 10 characters').max(200);

authRouter.post('/auth/password', requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.isDemo) throw new HttpError(403, 'demo_locked', 'Demo accounts cannot change their password');
  const body = z.object({ current: z.string().min(1, 'Enter your current password'), next: password }).parse(req.body);
  if (!(await bcrypt.compare(body.current, user.passwordHash))) {
    throw new HttpError(400, 'validation', 'Current password is incorrect');
  }
  await User.updateOne({ _id: user._id }, { passwordHash: await bcrypt.hash(body.next, 12) });
  await audit(user, 'auth.password_changed');
  res.json({ ok: true });
});

// ---- user management: admins manage everyone, organizers manage gate operators ----

authRouter.get('/users', requireAuth, requireRole('admin', 'organizer'), async (req, res) => {
  const filter: Record<string, unknown> = req.user!.role === 'admin' ? {} : { role: 'operator' };
  const users = await User.find(filter).sort({ createdAt: -1 }).lean<UserDoc[]>();
  res.json({ users: users.map(publicUser) });
});

authRouter.post('/users', requireAuth, requireRole('admin', 'organizer'), async (req, res) => {
  const actor = req.user!;
  if (actor.isDemo) throw new HttpError(403, 'demo_locked', 'Demo accounts cannot create users');
  const body = z
    .object({
      name: z.string().trim().min(2, 'Enter a name').max(80),
      email: z.email('Enter a valid email').toLowerCase(),
      password,
      role: z.enum(ROLES),
    })
    .parse(req.body);
  if (actor.role !== 'admin' && body.role !== 'operator') {
    throw new HttpError(403, 'forbidden', 'Organizers can only create gate operator accounts');
  }
  if (await User.exists({ email: body.email })) {
    throw new HttpError(409, 'conflict', 'An account with this email already exists');
  }
  const user = await User.create({
    name: body.name,
    email: body.email,
    role: body.role,
    passwordHash: await bcrypt.hash(body.password, 12),
    createdBy: actor._id,
  });
  await audit(actor, 'user.created', { target: body.email, details: { role: body.role } });
  res.status(201).json({ user: publicUser(user.toObject() as UserDoc) });
});

authRouter.patch('/users/:id', requireAuth, requireRole('admin', 'organizer'), async (req, res) => {
  const actor = req.user!;
  if (actor.isDemo) throw new HttpError(403, 'demo_locked', 'Demo accounts cannot manage users');
  const id = objectId.parse(req.params.id);
  const { disabled } = z.object({ disabled: z.boolean() }).parse(req.body);
  if (actor._id.equals(id)) throw new HttpError(400, 'validation', 'You cannot disable your own account');
  const target = await User.findById(id).lean<UserDoc>();
  if (!target) throw notFound('User');
  if (actor.role !== 'admin' && (target.role !== 'operator' || !target.createdBy?.equals(actor._id))) {
    throw new HttpError(403, 'forbidden', 'You can only manage operators you created');
  }
  await User.updateOne({ _id: id }, { disabled });
  await audit(actor, disabled ? 'user.disabled' : 'user.enabled', { target: target.email });
  res.json({ user: publicUser({ ...target, disabled }) });
});
