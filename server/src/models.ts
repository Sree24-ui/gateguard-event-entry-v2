import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';

export const ROLES = ['admin', 'organizer', 'operator'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    disabled: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

const eventSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    venue: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    capacity: { type: Number, default: null }, // null = unlimited
    // Maintained atomically on register/cancel so capacity checks are race-free.
    activeTickets: { type: Number, default: 0 },
    registrationOpen: { type: Boolean, default: true },
    gates: { type: [String], default: ['Main gate'] },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    staff: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [], index: true },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const TICKET_STATUS = ['valid', 'checked_in', 'cancelled'] as const;

const ticketSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    affiliation: { type: String, default: '' }, // e.g. college / department
    status: { type: String, enum: TICKET_STATUS, default: 'valid' },
    source: { type: String, enum: ['public', 'organizer', 'import', 'demo'], default: 'public' },
    checkedInAt: Date,
    checkedInBy: { type: Schema.Types.ObjectId, ref: 'User' },
    checkedInGate: String,
    checkedInScanId: String,
  },
  { timestamps: true },
);
// One registration per email per event; also serves event-scoped listing/count queries.
ticketSchema.index({ eventId: 1, email: 1 }, { unique: true });
ticketSchema.index({ eventId: 1, status: 1, checkedInAt: -1 });

export const SCAN_RESULTS = [
  'accepted',
  'duplicate',
  'tampered',
  'malformed',
  'wrong_event',
  'unknown',
  'cancelled',
] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

// Every scan attempt (accepted or not) — the source for analytics and the scan audit trail.
const scanSchema = new Schema({
  scanId: { type: String, required: true, unique: true }, // client-generated, makes retries idempotent
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  ticketCode: String,
  result: { type: String, enum: SCAN_RESULTS, required: true },
  method: { type: String, enum: ['camera', 'manual'], default: 'camera' },
  gate: { type: String, default: 'Main gate' },
  operatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  scannedAt: { type: Date, required: true }, // when the operator scanned (device clock)
  receivedAt: { type: Date, default: Date.now }, // when the server processed it
  offline: { type: Boolean, default: false },
  // An offline scan accepted provisionally on-device that the server then rejected.
  conflict: { type: Boolean, default: false },
});
scanSchema.index({ eventId: 1, receivedAt: -1 });

const auditSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  eventId: { type: Schema.Types.ObjectId, ref: 'Event' },
  target: String,
  details: Schema.Types.Mixed,
  at: { type: Date, default: Date.now, index: true },
});

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export type EventDoc = InferSchemaType<typeof eventSchema> & { _id: Types.ObjectId };
export type TicketDoc = InferSchemaType<typeof ticketSchema> & { _id: Types.ObjectId };

export const User = mongoose.model('User', userSchema);
export const Event = mongoose.model('Event', eventSchema);
export const Ticket = mongoose.model('Ticket', ticketSchema);
export const Scan = mongoose.model('Scan', scanSchema);
export const Audit = mongoose.model('Audit', auditSchema);
