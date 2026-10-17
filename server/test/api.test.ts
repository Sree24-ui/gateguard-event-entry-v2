import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/db.js';
import { signTicket } from '../src/lib/tickets.js';
import { Event, Scan, Ticket, User } from '../src/models.js';

const app = createApp();
let mongo: MongoMemoryServer | undefined;

async function agentFor(email: string, role: 'admin' | 'organizer' | 'operator', password = 'correct-horse-battery') {
  await User.create({ email, name: email.split('@')[0], role, passwordHash: await bcrypt.hash(password, 4) });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}

const eventBody = (name: string, extra: object = {}) => ({
  name,
  venue: 'Auditorium',
  startsAt: new Date(Date.now() - 3600_000).toISOString(),
  endsAt: new Date(Date.now() + 3600_000).toISOString(),
  gates: ['Main gate', 'East gate'],
  ...extra,
});

let organizer: request.Agent;
let operator: request.Agent;
let outsider: request.Agent;
let event: { id: string; slug: string };
let otherEvent: { id: string; slug: string };

const scan = (agent: request.Agent, eventId: string, payload: string, extra: object = {}) =>
  agent.post(`/api/events/${eventId}/checkin`).send({ scanId: randomUUID(), payload, gate: 'Main gate', ...extra });

async function register(slug: string, email: string) {
  const res = await request(app).post(`/api/public/events/${slug}/register`).send({ name: 'Test Person', email, affiliation: 'CSE' });
  expect(res.status).toBe(201);
  return res.body.ticket as { code: string; qr: string; email: string };
}

beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI ?? (mongo = await MongoMemoryServer.create()).getUri();
  await connectDb(uri);
  await Promise.all([User, Event, Ticket, Scan].map((m) => m.syncIndexes()));
  organizer = await agentFor('org@test.edu', 'organizer');
  operator = await agentFor('op@test.edu', 'operator');
  outsider = await agentFor('outsider@test.edu', 'operator');
  event = (await organizer.post('/api/events').send(eventBody('Hack Night')).expect(201)).body.event;
  otherEvent = (await organizer.post('/api/events').send(eventBody('Robotics Expo')).expect(201)).body.event;
  const users = (await organizer.get('/api/users').expect(200)).body.users as { id: string; email: string }[];
  const opId = users.find((u) => u.email === 'op@test.edu')!.id;
  await organizer.put(`/api/events/${event.id}/staff`).send({ userIds: [opId] }).expect(200);
  await organizer.put(`/api/events/${otherEvent.id}/staff`).send({ userIds: [opId] }).expect(200);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('events and registration', () => {
  it('rejects invalid event input server-side', async () => {
    const res = await organizer.post('/api/events').send({ name: 'x', venue: '', startsAt: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['name', 'venue', 'startsAt']));
  });

  it('rejects an end time before the start', async () => {
    const res = await organizer.post('/api/events').send(eventBody('Backwards', { endsAt: new Date(0).toISOString() }));
    expect(res.status).toBe(400);
    expect(res.body.error.fields.endsAt).toBeDefined();
  });

  it('issues unique, signed tickets without personal data in the QR', async () => {
    const a = await register(event.slug, 'a@test.edu');
    const b = await register(event.slug, 'b@test.edu');
    expect(a.code).not.toBe(b.code);
    expect(a.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(a.qr).toMatch(new RegExp(`^GG2\\.${event.id}\\.${a.code.replace(/-/g, '')}\\.[A-Za-z0-9_-]{86}$`));
    expect(a.qr).not.toContain('test.edu');
    expect(a.email).toBe('a••••@test.edu');
  });

  it('prevents duplicate registration by email', async () => {
    await register(event.slug, 'dup@test.edu');
    const res = await request(app).post(`/api/public/events/${event.slug}/register`).send({ name: 'Dup', email: 'DUP@test.edu' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_registered');
  });

  it('enforces capacity under concurrent registrations', async () => {
    const small = (await organizer.post('/api/events').send(eventBody('Tiny Workshop', { capacity: 3 })).expect(201)).body.event;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => request(app).post(`/api/public/events/${small.slug}/register`).send({ name: 'Racer', email: `r${i}@test.edu` })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'event_full')).toBe(true);
  });

  it('serves a public ticket page by code', async () => {
    const t = await register(event.slug, 'view@test.edu');
    const res = await request(app).get(`/api/public/tickets/${t.code.toLowerCase()}`).expect(200);
    expect(res.body.ticket.event.name).toBe('Hack Night');
    expect(res.body.ticket.status).toBe('valid');
  });
});

describe('gate check-in', () => {
  it('accepts a valid ticket once, increases attendance, then rejects the duplicate', async () => {
    const t = await register(event.slug, 'valid@test.edu');
    const before = (await operator.get(`/api/events/${event.id}/stats`).expect(200)).body;

    const ok = await scan(operator, event.id, t.qr).expect(200);
    expect(ok.body.result).toBe('accepted');
    expect(ok.body.attendee.name).toBe('Test Person');

    const after = (await operator.get(`/api/events/${event.id}/stats`).expect(200)).body;
    expect(after.checkedIn).toBe(before.checkedIn + 1);
    expect(after.remaining).toBe(before.remaining - 1);

    const again = await scan(operator, event.id, t.qr).expect(200);
    expect(again.body.result).toBe('duplicate');
    expect(again.body.checkedInGate).toBe('Main gate');
  });

  it('accepts manual code entry, tolerant of case and dashes', async () => {
    const t = await register(event.slug, 'manual@test.edu');
    const res = await scan(operator, event.id, t.code.toLowerCase().replace(/-/g, ' '), { method: 'manual' }).expect(200);
    expect(res.body.result).toBe('accepted');
  });

  it('rejects a tampered QR (valid shape, bad signature)', async () => {
    const t = await register(event.slug, 'tamper@test.edu');
    const sig = t.qr.slice(-86);
    const forged = t.qr.slice(0, -86) + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect((await scan(operator, event.id, forged)).body.result).toBe('tampered');
    // A forged code with a copied signature is also caught
    const swapped = t.qr.replace(/\.([0-9A-Z]{12})\./, '.ZZZZZZZZZZZZ.');
    expect((await scan(operator, event.id, swapped)).body.result).toBe('tampered');
  });

  it('rejects malformed and unknown payloads', async () => {
    expect((await scan(operator, event.id, 'https://example.com')).body.result).toBe('malformed');
    expect((await scan(operator, event.id, '0000-0000-0000')).body.result).toBe('unknown');
    // Properly signed but never issued
    const ghost = signTicket(event.id, 'ZZZZZZZZZZZZ');
    expect((await scan(operator, event.id, ghost)).body.result).toBe('unknown');
  });

  it('rejects a ticket from another event (QR and manual code)', async () => {
    const t = await register(otherEvent.slug, 'other@test.edu');
    expect((await scan(operator, event.id, t.qr)).body.result).toBe('wrong_event');
    expect((await scan(operator, event.id, t.code, { method: 'manual' })).body.result).toBe('wrong_event');
    // still valid at its own event
    expect((await scan(operator, otherEvent.id, t.qr)).body.result).toBe('accepted');
  });

  it('rejects cancelled tickets and allows reinstating them', async () => {
    const t = await register(event.slug, 'cancel@test.edu');
    await organizer.patch(`/api/events/${event.id}/attendees/${t.code}`).send({ status: 'cancelled' }).expect(200);
    expect((await scan(operator, event.id, t.qr)).body.result).toBe('cancelled');
    await organizer.patch(`/api/events/${event.id}/attendees/${t.code}`).send({ status: 'valid' }).expect(200);
    expect((await scan(operator, event.id, t.qr)).body.result).toBe('accepted');
    await organizer.patch(`/api/events/${event.id}/attendees/${t.code}`).send({ status: 'cancelled' }).expect(409);
  });

  it('allows exactly one official check-in under 25 simultaneous scans from different gates', async () => {
    const t = await register(event.slug, 'race@test.edu');
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => scan(operator, event.id, t.qr, { gate: i % 2 ? 'Main gate' : 'East gate' })),
    );
    const outcomes = results.map((r) => r.body.result);
    expect(outcomes.filter((r) => r === 'accepted')).toHaveLength(1);
    expect(outcomes.filter((r) => r === 'duplicate')).toHaveLength(24);
    const code = t.code.replace(/-/g, '');
    expect(await Scan.countDocuments({ ticketCode: code, result: 'accepted' })).toBe(1);
  });

  it('is idempotent on scanId retries (including concurrent retries)', async () => {
    const t = await register(event.slug, 'retry@test.edu');
    const scanId = randomUUID();
    const body = { scanId, payload: t.qr, gate: 'Main gate', offline: true, scannedAt: new Date().toISOString() };
    const results = await Promise.all(Array.from({ length: 5 }, () => operator.post(`/api/events/${event.id}/checkin`).send(body)));
    expect(results.map((r) => r.body.result)).toEqual(Array(5).fill('accepted'));
    expect(await Scan.countDocuments({ scanId })).toBe(1);
  });

  it('flags conflicting offline scans during reconciliation', async () => {
    const t = await register(event.slug, 'offline@test.edu');
    const gateA = await scan(operator, event.id, t.qr, { offline: true, gate: 'Main gate' });
    const gateB = await scan(operator, event.id, t.qr, { offline: true, gate: 'East gate' });
    expect(gateA.body).toMatchObject({ result: 'accepted', conflict: false });
    expect(gateB.body).toMatchObject({ result: 'duplicate', conflict: true });
    const stats = (await operator.get(`/api/events/${event.id}/stats`)).body;
    expect(stats.offlineConflicts).toBeGreaterThanOrEqual(1);
  });

  it('serves an offline manifest without personal data', async () => {
    const res = await operator.get(`/api/events/${event.id}/manifest`).expect(200);
    expect(res.body.tickets.length).toBeGreaterThan(5);
    expect(JSON.stringify(res.body)).not.toContain('@');
  });
});

describe('authorization', () => {
  it('requires a session', async () => {
    await request(app).get('/api/events').expect(401);
    await request(app).post(`/api/events/${event.id}/checkin`).send({ scanId: randomUUID(), payload: 'x' }).expect(401);
  });

  it('denies scanning by an operator not assigned to the event', async () => {
    const t = await register(event.slug, 'unauth@test.edu');
    const res = await scan(outsider, event.id, t.qr);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_assigned');
    expect((await Ticket.findOne({ email: 'unauth@test.edu' }))!.status).toBe('valid');
  });

  it('prevents operators from managing events, attendees and users', async () => {
    await operator.post('/api/events').send(eventBody('Nope')).expect(403);
    await operator.get(`/api/events/${event.id}/attendees`).expect(403);
    await operator.get('/api/users').expect(403);
    await outsider.get(`/api/events/${event.id}`).expect(404);
  });

  it('prevents organizers from creating admins or other organizers', async () => {
    const res = await organizer.post('/api/users').send({ name: 'Sneaky', email: 'sneaky@test.edu', password: 'long-enough-pass', role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('rejects wrong passwords without revealing whether the account exists', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: 'org@test.edu', password: 'wrong' });
    const b = await request(app).post('/api/auth/login').send({ email: 'nobody@test.edu', password: 'wrong' });
    expect(a.status).toBe(401);
    expect(b.body).toEqual(a.body);
  });
});

describe('exports and CSV import', () => {
  it('imports attendees from CSV with per-row errors', async () => {
    const csv = 'name,email,affiliation\n"Lee, Ann",ann@test.edu,ECE\nBad Row,not-an-email,\nann again,ann@test.edu,\n';
    const res = await organizer.post(`/api/events/${event.id}/attendees/import`).send({ csv }).expect(200);
    expect(res.body.created).toBe(1);
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
  });

  it('exports CSV with formula-injection protection', async () => {
    await organizer.post(`/api/events/${event.id}/attendees`).send({ name: '=HYPERLINK("x")', email: 'formula@test.edu' }).expect(201);
    const res = await organizer.get(`/api/events/${event.id}/export/attendees.csv`).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
