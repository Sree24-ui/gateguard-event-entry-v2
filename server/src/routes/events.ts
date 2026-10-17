import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { checkIn } from '../lib/checkin.js';
import { audit, eventScope, HttpError, limiter, loadEvent, notFound, objectId, requireAuth, requireRole } from '../lib/http.js';
import { attendeeInput, parseCsv, registerAttendee, toCsv } from '../lib/registration.js';
import { formatCode, normalizeCode, signTicket } from '../lib/tickets.js';
import { Audit, Event, Scan, SCAN_RESULTS, Ticket, User, type EventDoc, type TicketDoc, type UserDoc } from '../models.js';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const eventInput = z
  .object({
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(120),
    description: z.string().trim().max(2000).default(''),
    venue: z.string().trim().min(2, 'Enter a venue').max(160),
    startsAt: z.coerce.date({ error: 'Enter a start date and time' }),
    endsAt: z.coerce.date({ error: 'Enter an end date and time' }),
    capacity: z.number().int().min(1, 'Capacity must be at least 1').max(100_000).nullable().default(null),
    registrationOpen: z.boolean().default(true),
    gates: z.array(z.string().trim().min(1).max(40)).min(1, 'Add at least one gate').max(20).default(['Main gate']),
  })
  .refine((e) => e.endsAt > e.startsAt, { path: ['endsAt'], message: 'End must be after the start' });

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'event';

async function countsFor(eventIds: mongoose.Types.ObjectId[]) {
  const rows = await Ticket.aggregate<{ _id: { e: mongoose.Types.ObjectId; s: string }; n: number }>([
    { $match: { eventId: { $in: eventIds } } },
    { $group: { _id: { e: '$eventId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const map = new Map<string, { registered: number; checkedIn: number; cancelled: number }>();
  for (const id of eventIds) map.set(String(id), { registered: 0, checkedIn: 0, cancelled: 0 });
  for (const r of rows) {
    const c = map.get(String(r._id.e))!;
    if (r._id.s === 'cancelled') c.cancelled += r.n;
    else {
      c.registered += r.n;
      if (r._id.s === 'checked_in') c.checkedIn += r.n;
    }
  }
  return map;
}

function summarize(e: EventDoc, c: { registered: number; checkedIn: number; cancelled: number }, user: UserDoc) {
  return {
    id: String(e._id),
    name: e.name,
    slug: e.slug,
    description: e.description,
    venue: e.venue,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    capacity: e.capacity ?? null,
    registrationOpen: e.registrationOpen,
    gates: e.gates,
    isDemo: e.isDemo,
    staff: e.staff.map(String),
    canManage: user.role === 'admin' || e.ownerId.equals(user._id),
    ...c,
    remaining: c.registered - c.checkedIn,
    attendancePct: c.registered ? Math.round((c.checkedIn / c.registered) * 1000) / 10 : 0,
  };
}

// ---- events ----

eventsRouter.get('/events', async (req, res) => {
  const user = req.user!;
  const events = await Event.find(eventScope(user)).sort({ startsAt: -1 }).lean<EventDoc[]>();
  const counts = await countsFor(events.map((e) => e._id));
  res.json({ events: events.map((e) => summarize(e, counts.get(String(e._id))!, user)) });
});

eventsRouter.post('/events', requireRole('admin', 'organizer'), async (req, res) => {
  const body = eventInput.parse(req.body);
  const event = await Event.create({
    ...body,
    slug: `${slugify(body.name)}-${randomBytes(3).toString('hex')}`,
    ownerId: req.user!._id,
  });
  await audit(req.user, 'event.created', { eventId: event._id, target: body.name });
  const e = event.toObject() as EventDoc;
  res.status(201).json({ event: summarize(e, { registered: 0, checkedIn: 0, cancelled: 0 }, req.user!) });
});

eventsRouter.get('/events/:id', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id);
  const counts = await countsFor([event._id]);
  res.json({ event: summarize(event, counts.get(String(event._id))!, req.user!) });
});

eventsRouter.patch('/events/:id', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id, 'manage');
  const body = eventInput.parse({ ...event, ...req.body, capacity: req.body.capacity === undefined ? event.capacity ?? null : req.body.capacity });
  if (body.capacity != null && body.capacity < event.activeTickets) {
    throw new HttpError(400, 'validation', `Capacity can't be below the ${event.activeTickets} tickets already issued`);
  }
  await Event.updateOne({ _id: event._id }, body);
  await audit(req.user, 'event.updated', { eventId: event._id, target: body.name, details: Object.keys(req.body) });
  const updated = (await Event.findById(event._id).lean<EventDoc>())!;
  const counts = await countsFor([event._id]);
  res.json({ event: summarize(updated, counts.get(String(event._id))!, req.user!) });
});

eventsRouter.put('/events/:id/staff', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id, 'manage');
  const { userIds } = z.object({ userIds: z.array(objectId).max(100) }).parse(req.body);
  const valid = await User.find({ _id: { $in: userIds }, role: { $in: ['operator', 'organizer'] } }).distinct('_id');
  await Event.updateOne({ _id: event._id }, { staff: valid });
  await audit(req.user, 'event.staff_updated', { eventId: event._id, target: event.name, details: { count: valid.length } });
  res.json({ staff: valid.map(String) });
});

// ---- live stats ----

eventsRouter.get('/events/:id/stats', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id);
  const eventId = event._id;
  const [counts, byResult, byGate, recentCheckins, recentScans, timeline, conflicts] = await Promise.all([
    countsFor([eventId]),
    Scan.aggregate([{ $match: { eventId } }, { $group: { _id: '$result', n: { $sum: 1 } } }]),
    Ticket.aggregate([
      { $match: { eventId, status: 'checked_in' } },
      { $group: { _id: '$checkedInGate', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    Ticket.find({ eventId, status: 'checked_in' }).sort({ checkedInAt: -1 }).limit(8).select('name affiliation code checkedInAt checkedInGate').lean(),
    Scan.find({ eventId }).sort({ receivedAt: -1 }).limit(12).populate<{ operatorId: UserDoc }>('operatorId', 'name').lean(),
    Ticket.aggregate([
      { $match: { eventId, status: 'checked_in' } },
      { $group: { _id: { $dateTrunc: { date: '$checkedInAt', unit: 'minute', binSize: 15 } }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Scan.countDocuments({ eventId, conflict: true }),
  ]);
  const c = counts.get(String(eventId))!;
  res.json({
    eventId: String(eventId),
    generatedAt: new Date(),
    registered: c.registered,
    checkedIn: c.checkedIn,
    cancelled: c.cancelled,
    remaining: c.registered - c.checkedIn,
    attendancePct: c.registered ? Math.round((c.checkedIn / c.registered) * 1000) / 10 : 0,
    scansByResult: Object.fromEntries(SCAN_RESULTS.map((r) => [r, byResult.find((b) => b._id === r)?.n ?? 0])),
    offlineConflicts: conflicts,
    byGate: byGate.map((g) => ({ gate: g._id ?? 'Unknown', checkedIn: g.n })),
    timeline: timeline.map((t) => ({ at: t._id, checkedIn: t.n })),
    recentCheckins: recentCheckins.map((t) => ({
      name: t.name,
      affiliation: t.affiliation,
      code: formatCode(t.code),
      at: t.checkedInAt,
      gate: t.checkedInGate,
    })),
    recentScans: recentScans.map(scanView),
  });
});

function scanView(s: {
  scanId: string;
  result: string;
  ticketCode?: string | null;
  gate?: string | null;
  method?: string | null;
  scannedAt: Date;
  receivedAt?: Date | null;
  offline?: boolean | null;
  conflict?: boolean | null;
  operatorId: UserDoc | null;
}) {
  return {
    scanId: s.scanId,
    result: s.result,
    code: s.ticketCode ? formatCode(s.ticketCode) : null,
    gate: s.gate,
    method: s.method,
    scannedAt: s.scannedAt,
    receivedAt: s.receivedAt,
    offline: !!s.offline,
    conflict: !!s.conflict,
    operator: s.operatorId?.name ?? 'Unknown',
  };
}

// ---- check-in ----

const checkinLimiter = limiter(60_000, 300, 'Scanning too fast — slow down for a moment', {
  keyGenerator: (req) => String(req.user?._id),
});

eventsRouter.post('/events/:id/checkin', checkinLimiter, async (req, res) => {
  const user = req.user!;
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Event');
  const event = await Event.findOne({ _id: req.params.id, ...eventScope(user) }).lean<EventDoc>();
  if (!event) {
    if (await Event.exists({ _id: req.params.id })) {
      throw new HttpError(403, 'not_assigned', 'You are not assigned as staff for this event');
    }
    throw notFound('Event');
  }
  const body = z
    .object({
      scanId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid scan id'),
      payload: z.string().min(1, 'Empty scan').max(400),
      gate: z.string().trim().min(1).max(40).default('Main gate'),
      method: z.enum(['camera', 'manual']).default('camera'),
      scannedAt: z.coerce.date().optional(),
      offline: z.boolean().default(false),
    })
    .parse(req.body);
  const now = Date.now();
  // Trust the device clock only within sane bounds (offline scans may be hours old, never in the future).
  const scannedAt =
    body.scannedAt && body.scannedAt.getTime() <= now + 5 * 60_000 && body.scannedAt.getTime() > now - 7 * 86400_000
      ? body.scannedAt
      : new Date(now);
  const result = await checkIn(event, user, { ...body, scannedAt });
  res.json(result);
});

/** Offline pack for scanners: ticket codes + status only, no personal data. */
eventsRouter.get('/events/:id/manifest', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id);
  const tickets = await Ticket.find({ eventId: event._id }).select('code status -_id').lean();
  res.set('Cache-Control', 'no-store');
  res.json({
    eventId: String(event._id),
    generatedAt: new Date(),
    tickets: tickets.map((t) => [t.code, t.status === 'valid' ? 'v' : t.status === 'checked_in' ? 'c' : 'x']),
  });
});

// ---- attendees ----

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ticketView(t: TicketDoc) {
  return {
    code: formatCode(t.code),
    name: t.name,
    email: t.email,
    affiliation: t.affiliation,
    status: t.status,
    source: t.source,
    createdAt: (t as unknown as { createdAt: Date }).createdAt,
    checkedInAt: t.checkedInAt ?? null,
    checkedInGate: t.checkedInGate ?? null,
  };
}

eventsRouter.get('/events/:id/attendees', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id, 'manage');
  const q = z
    .object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(['valid', 'checked_in', 'cancelled']).optional(),
      page: z.coerce.number().int().min(1).default(1),
    })
    .parse(req.query);
  const filter: Record<string, unknown> = { eventId: event._id };
  if (q.status) filter.status = q.status;
  if (q.q) {
    const code = normalizeCode(q.q);
    const re = new RegExp(escapeRe(q.q), 'i');
    filter.$or = [{ name: re }, { email: re }, { affiliation: re }, ...(code ? [{ code }] : [])];
  }
  const pageSize = 50;
  const [total, tickets] = await Promise.all([
    Ticket.countDocuments(filter),
    Ticket.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * pageSize).limit(pageSize).lean<TicketDoc[]>(),
  ]);
  res.json({ total, page: q.page, pageSize, attendees: tickets.map(ticketView) });
});

eventsRouter.post('/events/:id/attendees', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id, 'manage');
  const ticket = await registerAttendee(event, attendeeInput.parse(req.body), 'organizer');
  await audit(req.user, 'attendee.added', { eventId: event._id, target: formatCode(ticket.code) });
  res.status(201).json({ attendee: ticketView(ticket.toObject() as TicketDoc) });
});

eventsRouter.post('/events/:id/attendees/import', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id, 'manage');
  const { csv } = z.object({ csv: z.string().min(1, 'Paste or upload a CSV').max(500_000) }).parse(req.body);
  const rows = parseCsv(csv);
  const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (n: string) => header.indexOf(n);
  if (col('name') < 0 || col('email') < 0) {
    throw new HttpError(400, 'validation', 'CSV needs a header row with at least "name" and "email" columns');
  }
  if (rows.length - 1 > 2000) throw new HttpError(400, 'validation', 'Import up to 2000 rows at a time');
  let created = 0;
  const errors: { row: number; message: string }[] = [];
  for (const [i, r] of rows.slice(1).entries()) {
    const parsed = attendeeInput.safeParse({ name: r[col('name')], email: r[col('email')], affiliation: col('affiliation') >= 0 ? r[col('affiliation')] : '' });
    if (!parsed.success) {
      errors.push({ row: i + 2, message: parsed.error.issues[0].message });
      continue;
    }
    try {
      await registerAttendee(event, parsed.data, 'import');
      created++;
    } catch (err) {
      errors.push({ row: i + 2, message: err instanceof HttpError ? err.message : 'Could not import row' });
      if (err instanceof HttpError && err.code === 'event_full') break;
    }
  }
  await audit(req.user, 'attendee.imported', { eventId: event._id, target: event.name, details: { created, failed: errors.length } });
  res.json({ created, errors: errors.slice(0, 100), failed: errors.length });
});

eventsRouter.patch('/events/:id/attendees/:code', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id, 'manage');
  const code = normalizeCode(req.params.code);
  if (!code) throw notFound('Ticket');
  const { status } = z.object({ status: z.enum(['valid', 'cancelled']) }).parse(req.body);
  const from = status === 'cancelled' ? 'valid' : 'cancelled';
  // Only un-used tickets can be cancelled; checked-in attendance is never rewritten.
  const ticket = await Ticket.findOneAndUpdate({ eventId: event._id, code, status: from }, { status }, { returnDocument: 'after' }).lean<TicketDoc>();
  if (!ticket) {
    const exists = await Ticket.findOne({ eventId: event._id, code }).lean<TicketDoc>();
    if (!exists) throw notFound('Ticket');
    throw new HttpError(409, 'invalid_state', `Ticket is ${exists.status.replace('_', ' ')} and can't be changed to ${status}`);
  }
  await Event.updateOne({ _id: event._id }, { $inc: { activeTickets: status === 'cancelled' ? -1 : 1 } });
  await audit(req.user, status === 'cancelled' ? 'ticket.cancelled' : 'ticket.reinstated', { eventId: event._id, target: formatCode(code) });
  res.json({ attendee: ticketView(ticket) });
});

eventsRouter.get('/events/:id/attendees/:code/qr', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id, 'manage');
  const code = normalizeCode(req.params.code);
  if (!code || !(await Ticket.exists({ eventId: event._id, code }))) throw notFound('Ticket');
  res.json({ payload: signTicket(String(event._id), code), code: formatCode(code) });
});

// ---- scans, exports, audit ----

eventsRouter.get('/events/:id/scans', async (req, res) => {
  const event = await loadEvent(req.user!, req.params.id);
  const q = z
    .object({
      result: z.enum(SCAN_RESULTS).optional(),
      conflict: z.literal('1').optional(),
      page: z.coerce.number().int().min(1).default(1),
    })
    .parse(req.query);
  const filter: Record<string, unknown> = { eventId: event._id };
  if (q.result) filter.result = q.result;
  if (q.conflict) filter.conflict = true;
  const pageSize = 50;
  const [total, scans] = await Promise.all([
    Scan.countDocuments(filter),
    Scan.find(filter)
      .sort({ receivedAt: -1 })
      .skip((q.page - 1) * pageSize)
      .limit(pageSize)
      .populate<{ operatorId: UserDoc }>('operatorId', 'name')
      .lean(),
  ]);
  res.json({ total, page: q.page, pageSize, scans: scans.map(scanView) });
});

eventsRouter.get('/events/:id/export/:kind', async (req, res) => {
  const kind = z.enum(['attendees.csv', 'scans.csv']).parse(req.params.kind);
  const event = await loadEvent(req.user!, req.params.id, 'manage');
  let csv: string;
  if (kind === 'attendees.csv') {
    const tickets = await Ticket.find({ eventId: event._id }).sort({ createdAt: 1 }).lean<TicketDoc[]>();
    csv = toCsv([
      ['code', 'name', 'email', 'affiliation', 'status', 'source', 'registered_at', 'checked_in_at', 'gate'],
      ...tickets.map((t) => [
        formatCode(t.code),
        t.name,
        t.email,
        t.affiliation,
        t.status,
        t.source,
        (t as unknown as { createdAt: Date }).createdAt,
        t.checkedInAt,
        t.checkedInGate,
      ]),
    ]);
  } else {
    const scans = await Scan.find({ eventId: event._id }).sort({ receivedAt: 1 }).populate<{ operatorId: UserDoc }>('operatorId', 'name').lean();
    csv = toCsv([
      ['scan_id', 'result', 'ticket_code', 'gate', 'method', 'operator', 'scanned_at', 'received_at', 'offline', 'offline_conflict'],
      ...scans.map((s) => [
        s.scanId,
        s.result,
        s.ticketCode ? formatCode(s.ticketCode) : '',
        s.gate,
        s.method,
        s.operatorId?.name,
        s.scannedAt,
        s.receivedAt,
        s.offline,
        s.conflict,
      ]),
    ]);
  }
  await audit(req.user, 'export.downloaded', { eventId: event._id, target: kind });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${event.slug}-${kind}"`);
  res.send(csv);
});

eventsRouter.get('/audit', requireRole('admin', 'organizer'), async (req, res) => {
  const user = req.user!;
  const { page } = z.object({ page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
  let filter: Record<string, unknown> = {};
  if (user.role !== 'admin') {
    const owned = await Event.find({ ownerId: user._id }).distinct('_id');
    filter = { $or: [{ actorId: user._id }, { eventId: { $in: owned } }] };
  }
  const pageSize = 50;
  const [total, entries] = await Promise.all([
    Audit.countDocuments(filter),
    Audit.find(filter)
      .sort({ at: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate<{ actorId: UserDoc | null }>('actorId', 'name email')
      .populate<{ eventId: EventDoc | null }>('eventId', 'name')
      .lean(),
  ]);
  res.json({
    total,
    page,
    pageSize,
    entries: entries.map((a) => ({
      id: String(a._id),
      action: a.action,
      at: a.at,
      actor: a.actorId ? a.actorId.name : null,
      event: a.eventId ? a.eventId.name : null,
      target: a.target ?? null,
      details: a.details ?? null,
    })),
  });
});

// ---- organizer dashboard: all accessible events at once ----

eventsRouter.get('/dashboard', async (req, res) => {
  const user = req.user!;
  const events = await Event.find(eventScope(user)).sort({ startsAt: 1 }).lean<EventDoc[]>();
  const ids = events.map((e) => e._id);
  const hourAgo = new Date(Date.now() - 3600_000);
  const [counts, lastHour, recentScans, conflicts] = await Promise.all([
    countsFor(ids),
    Scan.aggregate([
      { $match: { eventId: { $in: ids }, receivedAt: { $gte: hourAgo } } },
      { $group: { _id: '$result', n: { $sum: 1 } } },
    ]),
    Scan.find({ eventId: { $in: ids } })
      .sort({ receivedAt: -1 })
      .limit(10)
      .populate<{ operatorId: UserDoc }>('operatorId', 'name')
      .populate<{ eventId: EventDoc }>('eventId', 'name')
      .lean(),
    Scan.aggregate([{ $match: { eventId: { $in: ids }, conflict: true } }, { $group: { _id: '$eventId', n: { $sum: 1 } } }]),
  ]);
  const summaries = events.map((e) => summarize(e, counts.get(String(e._id))!, user));
  const now = Date.now();

  // Alerts are derived only from real data; each one names the event it concerns.
  const alerts: { level: 'warning' | 'info'; eventId: string; message: string }[] = [];
  for (const e of summaries) {
    const live = new Date(e.startsAt).getTime() - 2 * 3600_000 < now && new Date(e.endsAt).getTime() > now;
    if (live && e.staff.length === 0 && e.canManage) {
      alerts.push({ level: 'warning', eventId: e.id, message: `${e.name} is starting or live but has no gate staff assigned` });
    }
    if (e.capacity && e.registered >= e.capacity * 0.9 && e.registrationOpen) {
      alerts.push({ level: 'info', eventId: e.id, message: `${e.name} is at ${Math.round((e.registered / e.capacity) * 100)}% of capacity` });
    }
    const conflict = conflicts.find((c) => String(c._id) === e.id);
    if (conflict) {
      alerts.push({ level: 'warning', eventId: e.id, message: `${conflict.n} offline scan${conflict.n > 1 ? 's' : ''} at ${e.name} conflicted on sync — review them` });
    }
  }
  res.json({
    events: summaries,
    totals: summaries.reduce(
      (t, e) => ({ registered: t.registered + e.registered, checkedIn: t.checkedIn + e.checkedIn }),
      { registered: 0, checkedIn: 0 },
    ),
    lastHour: Object.fromEntries(SCAN_RESULTS.map((r) => [r, lastHour.find((b) => b._id === r)?.n ?? 0])),
    recentScans: recentScans.map((s) => ({ ...scanView({ ...s, operatorId: s.operatorId }), event: s.eventId?.name ?? '' })),
    alerts,
  });
});
