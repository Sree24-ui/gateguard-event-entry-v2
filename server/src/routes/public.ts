import { Router } from 'express';
import { HttpError, limiter, notFound } from '../lib/http.js';
import { attendeeInput, registerAttendee } from '../lib/registration.js';
import { formatCode, normalizeCode, publicKeyRaw, signTicket } from '../lib/tickets.js';
import { Event, Ticket, type EventDoc, type TicketDoc } from '../models.js';

export const publicRouter = Router();

const registerLimiter = limiter(10 * 60_000, 15, 'Too many registrations from this network. Try again later.');
const lookupLimiter = limiter(60_000, 60, 'Too many lookups. Try again in a minute.');

const publicEvent = (e: EventDoc) => ({
  id: String(e._id),
  name: e.name,
  slug: e.slug,
  description: e.description,
  venue: e.venue,
  startsAt: e.startsAt,
  endsAt: e.endsAt,
  registrationOpen: e.registrationOpen && e.endsAt > new Date(),
  spotsLeft: e.capacity == null ? null : Math.max(0, e.capacity - e.activeTickets),
  isDemo: e.isDemo,
});

const maskEmail = (email: string) => email.replace(/^(.)(.*)(@.*)$/, (_m, a, _b, d) => a + '••••' + d);

function publicTicket(t: TicketDoc, e: EventDoc) {
  return {
    code: formatCode(t.code),
    name: t.name,
    email: maskEmail(t.email),
    affiliation: t.affiliation,
    status: t.status,
    checkedInAt: t.checkedInAt ?? null,
    qr: signTicket(String(e._id), t.code),
    event: publicEvent(e),
  };
}

publicRouter.get('/public/ticket-key', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ alg: 'Ed25519', publicKey: publicKeyRaw() });
});

publicRouter.get('/public/events/:slug', lookupLimiter, async (req, res) => {
  const event = await Event.findOne({ slug: String(req.params.slug) }).lean<EventDoc>();
  if (!event) throw notFound('Event');
  res.json({ event: publicEvent(event) });
});

publicRouter.post('/public/events/:slug/register', registerLimiter, async (req, res) => {
  const event = await Event.findOne({ slug: String(req.params.slug) }).lean<EventDoc>();
  if (!event) throw notFound('Event');
  if (!publicEvent(event).registrationOpen) throw new HttpError(409, 'registration_closed', 'Registration for this event is closed');
  const ticket = await registerAttendee(event, attendeeInput.parse(req.body), 'public');
  res.status(201).json({ ticket: publicTicket(ticket.toObject() as TicketDoc, event) });
});

// The 60-bit code is the bearer secret for the ticket page; email is masked on purpose.
publicRouter.get('/public/tickets/:code', lookupLimiter, async (req, res) => {
  const code = normalizeCode(String(req.params.code));
  const ticket = code ? await Ticket.findOne({ code }).lean<TicketDoc>() : null;
  if (!ticket) throw notFound('Ticket');
  const event = (await Event.findById(ticket.eventId).lean<EventDoc>())!;
  res.set('Cache-Control', 'no-store');
  res.json({ ticket: publicTicket(ticket, event) });
});
