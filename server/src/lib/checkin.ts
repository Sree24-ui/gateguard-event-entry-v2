import { Scan, Ticket, type EventDoc, type ScanResult, type TicketDoc, type UserDoc } from '../models.js';
import { formatCode, parsePayload } from './tickets.js';

export interface CheckinInput {
  scanId: string;
  payload: string;
  gate: string;
  method: 'camera' | 'manual';
  scannedAt: Date;
  offline: boolean;
}

export interface CheckinOutcome {
  scanId: string;
  result: ScanResult;
  message: string;
  conflict: boolean;
  attendee?: { name: string; affiliation: string; code: string };
  checkedInAt?: Date;
  checkedInGate?: string;
}

const MESSAGES: Record<ScanResult, string> = {
  accepted: 'Admit — ticket verified and checked in',
  duplicate: 'Already checked in — this ticket was used before',
  tampered: 'Invalid signature — QR is forged or altered',
  malformed: 'Not a GateGuard ticket — unreadable or unknown format',
  wrong_event: 'Wrong event — this ticket is for a different event',
  unknown: 'Unknown ticket — no registration matches this code',
  cancelled: 'Cancelled ticket — registration was revoked',
};

/**
 * Decides and records one scan. Duplicate prevention relies on a single atomic
 * `findOneAndUpdate({status:'valid'} → 'checked_in')`: under any concurrency, exactly one
 * caller sees the transition. Retries are idempotent via the unique `scanId`.
 */
export async function checkIn(event: EventDoc, operator: UserDoc, input: CheckinInput): Promise<CheckinOutcome> {
  const prior = await Scan.findOne({ scanId: input.scanId }).lean();
  if (prior) return replay(prior);

  const { result, ticket } = await decide(event, operator, input);
  const conflict = input.offline && result !== 'accepted';
  try {
    await Scan.create({
      scanId: input.scanId,
      eventId: event._id,
      ticketCode: ticket?.code,
      result,
      method: input.method,
      gate: input.gate,
      operatorId: operator._id,
      scannedAt: input.scannedAt,
      offline: input.offline,
      conflict,
    });
  } catch (err) {
    // Same scanId raced in concurrently: the other request's record is authoritative.
    if ((err as { code?: number }).code === 11000) {
      const winner = await Scan.findOne({ scanId: input.scanId }).lean();
      if (winner) return replay(winner);
    }
    throw err;
  }
  return outcome(input.scanId, result, conflict, ticket);
}

async function decide(event: EventDoc, operator: UserDoc, input: CheckinInput): Promise<{ result: ScanResult; ticket?: TicketDoc }> {
  const parsed = parsePayload(input.payload);
  if (parsed.kind === 'malformed') return { result: 'malformed' };
  if (parsed.kind === 'qr') {
    if (!parsed.signatureValid) return { result: 'tampered' };
    if (parsed.eventId !== String(event._id)) return { result: 'wrong_event' };
  }

  const existing = await Ticket.findOne({ code: parsed.code }).lean<TicketDoc>();
  if (!existing) return { result: 'unknown' };
  if (!existing.eventId.equals(event._id)) return { result: 'wrong_event' };

  const updated = await Ticket.findOneAndUpdate(
    { _id: existing._id, status: 'valid' },
    {
      $set: {
        status: 'checked_in',
        checkedInAt: new Date(),
        checkedInBy: operator._id,
        checkedInGate: input.gate,
        checkedInScanId: input.scanId,
      },
    },
    { returnDocument: 'after' },
  ).lean<TicketDoc>();
  if (updated) return { result: 'accepted', ticket: updated };

  const current = await Ticket.findById(existing._id).lean<TicketDoc>();
  // A concurrent retry of this very scan won the transition — it's the same check-in, not a duplicate.
  if (current?.checkedInScanId === input.scanId) return { result: 'accepted', ticket: current };
  return { result: current?.status === 'cancelled' ? 'cancelled' : 'duplicate', ticket: current ?? existing };
}

async function replay(scan: { scanId: string; result: string; conflict?: boolean | null; ticketCode?: string | null }) {
  const ticket = scan.ticketCode ? await Ticket.findOne({ code: scan.ticketCode }).lean<TicketDoc>() : null;
  return outcome(scan.scanId, scan.result as ScanResult, !!scan.conflict, ticket ?? undefined);
}

function outcome(scanId: string, result: ScanResult, conflict: boolean, ticket?: TicketDoc): CheckinOutcome {
  const showAttendee = result === 'accepted' || result === 'duplicate' || result === 'cancelled';
  return {
    scanId,
    result,
    conflict,
    message: conflict ? `Offline scan rejected on sync — ${MESSAGES[result].toLowerCase()}` : MESSAGES[result],
    attendee:
      ticket && showAttendee ? { name: ticket.name, affiliation: ticket.affiliation ?? '', code: formatCode(ticket.code) } : undefined,
    checkedInAt: ticket?.checkedInAt ?? undefined,
    checkedInGate: ticket?.checkedInGate ?? undefined,
  };
}
