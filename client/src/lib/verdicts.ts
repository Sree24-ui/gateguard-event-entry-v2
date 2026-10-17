import { Ban, CircleCheckBig, CircleHelp, CopyX, FileWarning, MapPinOff, ShieldAlert, type LucideIcon } from 'lucide-react';
import type { ScanResult } from './types';

export type Tone = 'admit' | 'deny' | 'caution' | 'info';

/** Every scan outcome has a word, an icon and a tone — never colour alone. */
export const VERDICTS: Record<ScanResult, { word: string; label: string; icon: LucideIcon; tone: Tone; help: string }> = {
  accepted: { word: 'ADMIT', label: 'Admitted', icon: CircleCheckBig, tone: 'admit', help: 'Valid ticket, first scan — official check-in recorded.' },
  duplicate: { word: 'USED', label: 'Duplicate', icon: CopyX, tone: 'deny', help: 'Ticket was already checked in. Shows when and at which gate.' },
  tampered: { word: 'FORGED', label: 'Tampered', icon: ShieldAlert, tone: 'deny', help: 'Looks like a GateGuard QR, but the cryptographic signature does not match.' },
  malformed: { word: 'INVALID', label: 'Unreadable', icon: FileWarning, tone: 'deny', help: 'Not a GateGuard ticket — a random QR, URL or damaged code.' },
  wrong_event: { word: 'WRONG EVENT', label: 'Wrong event', icon: MapPinOff, tone: 'deny', help: 'Genuine ticket, but for a different event.' },
  unknown: { word: 'UNKNOWN', label: 'Unknown', icon: CircleHelp, tone: 'deny', help: 'No registration matches this ticket code.' },
  cancelled: { word: 'CANCELLED', label: 'Cancelled', icon: Ban, tone: 'deny', help: 'The organizer revoked this registration.' },
};

export const RESULT_ORDER: ScanResult[] = ['accepted', 'duplicate', 'tampered', 'wrong_event', 'unknown', 'cancelled', 'malformed'];
