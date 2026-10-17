/**
 * Idempotent setup: builds indexes, creates the admin from ADMIN_EMAIL/ADMIN_PASSWORD and,
 * unless SEED_DEMO=false, a clearly labelled demo workspace (demo organizer, demo operator,
 * one demo event with sample registrations checked in through the real check-in path).
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { checkIn } from './lib/checkin.js';
import { registerAttendee } from './lib/registration.js';
import { signTicket } from './lib/tickets.js';
import { Audit, Event, Scan, Ticket, User, type EventDoc, type Role, type UserDoc } from './models.js';

export const DEMO = {
  organizer: { email: 'organizer@demo.gateguard.dev', name: 'Demo Organizer' },
  operator: { email: 'gate@demo.gateguard.dev', name: 'Demo Gate Operator' },
  password: process.env.DEMO_PASSWORD ?? 'gateguard-demo',
};

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Ishaan', 'Saanvi', 'Vihaan', 'Aditi', 'Arjun', 'Kavya', 'Neel', 'Riya', 'Siddharth', 'Tara'];
const LAST = ['Sharma', 'Iyer', 'Patil', 'Khan', 'Deshmukh', 'Rao', 'Kulkarni', 'Menon', 'Joshi', 'Nair', 'Gupta', 'Bose'];
const DEPTS = ['Computer Engg.', 'Electronics', 'Mechanical', 'IT', 'Civil', 'AI & DS'];

async function upsertUser(email: string, name: string, role: Role, password: string, isDemo: boolean) {
  const existing = await User.findOne({ email });
  if (existing) return existing.toObject() as UserDoc;
  const user = await User.create({ email, name, role, isDemo, passwordHash: await bcrypt.hash(password, 12) });
  console.log(`created ${role} ${email}`);
  return user.toObject() as UserDoc;
}

export async function seed() {
  await Promise.all([User, Event, Ticket, Scan, Audit].map((m) => m.syncIndexes()));

  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) await upsertUser(ADMIN_EMAIL.toLowerCase(), 'Administrator', 'admin', ADMIN_PASSWORD, false);
  else console.log('ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin account');

  if (process.env.SEED_DEMO === 'false') return;
  const organizer = await upsertUser(DEMO.organizer.email, DEMO.organizer.name, 'organizer', DEMO.password, true);
  const operator = await upsertUser(DEMO.operator.email, DEMO.operator.name, 'operator', DEMO.password, true);
  if (await Event.exists({ isDemo: true })) return console.log('demo event already present');

  const start = new Date(Date.now() - 3600_000);
  const event = (
    await Event.create({
      name: 'TechNova Fest 2026 (Demo)',
      slug: 'technova-demo',
      description: 'Demo event with sample registrations. Data here is fictional and shared by everyone using the demo login.',
      venue: 'Main Auditorium, North Campus',
      startsAt: start,
      endsAt: new Date(start.getTime() + 8 * 3600_000),
      capacity: 300,
      gates: ['Main gate', 'Library gate'],
      ownerId: organizer._id,
      staff: [operator._id],
      isDemo: true,
    })
  ).toObject() as EventDoc;

  const codes: string[] = [];
  for (let i = 0; i < 48; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const t = await registerAttendee(
      event,
      { name: `${first} ${last}`, email: `${first}.${last}.${i}@example.edu`.toLowerCase(), affiliation: DEPTS[i % DEPTS.length] },
      'demo',
    );
    codes.push(t.code);
  }
  for (const [i, code] of codes.slice(0, 19).entries()) {
    await checkIn(event, operator, {
      scanId: randomUUID(),
      payload: signTicket(String(event._id), code),
      gate: i % 3 === 0 ? 'Library gate' : 'Main gate',
      method: 'camera',
      scannedAt: new Date(),
      offline: false,
    });
  }
  // One genuine duplicate attempt so the rejection analytics have something real to show.
  await checkIn(event, operator, { scanId: randomUUID(), payload: signTicket(String(event._id), codes[0]), gate: 'Main gate', method: 'camera', scannedAt: new Date(), offline: false });
  console.log(`demo event seeded: /e/${event.slug}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await connectDb();
  await seed();
  await mongoose.disconnect();
}
