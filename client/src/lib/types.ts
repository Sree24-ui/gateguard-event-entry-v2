export type Role = 'admin' | 'organizer' | 'operator';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  isDemo: boolean;
}

export interface EventSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  registrationOpen: boolean;
  gates: string[];
  isDemo: boolean;
  staff: string[];
  canManage: boolean;
  registered: number;
  checkedIn: number;
  cancelled: number;
  remaining: number;
  attendancePct: number;
}

export type ScanResult = 'accepted' | 'duplicate' | 'tampered' | 'malformed' | 'wrong_event' | 'unknown' | 'cancelled';

export interface ScanRow {
  scanId: string;
  result: ScanResult;
  code: string | null;
  gate: string;
  method: 'camera' | 'manual';
  scannedAt: string;
  receivedAt: string;
  offline: boolean;
  conflict: boolean;
  operator: string;
  event?: string;
}

export interface EventStats {
  eventId: string;
  generatedAt: string;
  registered: number;
  checkedIn: number;
  cancelled: number;
  remaining: number;
  attendancePct: number;
  scansByResult: Record<ScanResult, number>;
  offlineConflicts: number;
  byGate: { gate: string; checkedIn: number }[];
  timeline: { at: string; checkedIn: number }[];
  recentCheckins: { name: string; affiliation: string; code: string; at: string; gate: string }[];
  recentScans: ScanRow[];
}

export interface Attendee {
  code: string;
  name: string;
  email: string;
  affiliation: string;
  status: 'valid' | 'checked_in' | 'cancelled';
  source: string;
  createdAt: string;
  checkedInAt: string | null;
  checkedInGate: string | null;
}

export interface PublicEvent {
  id: string;
  name: string;
  slug: string;
  description: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  registrationOpen: boolean;
  spotsLeft: number | null;
  isDemo: boolean;
}

export interface PublicTicket {
  code: string;
  name: string;
  email: string;
  affiliation: string;
  status: Attendee['status'];
  checkedInAt: string | null;
  qr: string;
  event: PublicEvent;
}

export interface CheckinOutcome {
  scanId: string;
  result: ScanResult;
  message: string;
  conflict: boolean;
  attendee?: { name: string; affiliation: string; code: string };
  checkedInAt?: string;
  checkedInGate?: string;
}

export type PageOf<K extends string, T> = { total: number; page: number; pageSize: number } & Record<K, T[]>;
