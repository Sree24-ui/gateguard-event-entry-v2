import { z } from 'zod';
import { Event, Ticket, type EventDoc, type TicketDoc } from '../models.js';
import { HttpError } from './http.js';
import { newTicketCode } from './tickets.js';

export const attendeeInput = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(100),
  email: z.email('Enter a valid email').toLowerCase().max(200),
  affiliation: z.string().trim().max(120).optional().default(''),
});
export type AttendeeInput = z.infer<typeof attendeeInput>;

/**
 * Reserves a capacity slot atomically, then issues the ticket. The unique (eventId, email)
 * index rejects duplicate registrations; the slot is released if the insert fails.
 */
export async function registerAttendee(event: EventDoc, input: AttendeeInput, source: TicketDoc['source']) {
  const reserved = await Event.findOneAndUpdate(
    { _id: event._id, $or: [{ capacity: null }, { $expr: { $lt: ['$activeTickets', '$capacity'] } }] },
    { $inc: { activeTickets: 1 } },
  );
  if (!reserved) throw new HttpError(409, 'event_full', 'This event has reached its registration limit');
  try {
    return await Ticket.create({ ...input, eventId: event._id, code: newTicketCode(), source });
  } catch (err) {
    await Event.updateOne({ _id: event._id }, { $inc: { activeTickets: -1 } });
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, 'already_registered', 'This email is already registered for this event');
    }
    throw err;
  }
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** CSV cell with formula-injection guard for spreadsheet apps. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
