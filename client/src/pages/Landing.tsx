import {
  ArrowRight,
  CloudOff,
  Fingerprint,
  Gauge,
  QrCode,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  Users,
  WifiOff,
} from 'lucide-react';
import { Link } from 'react-router';
import { Brand } from '../components/ui';
import { RESULT_ORDER, VERDICTS } from '../lib/verdicts';

const REPO = 'https://github.com/Sree24-ui/gateguard-event-entry-v2';

const TICKER = [
  ['ADMIT', 'valid · first scan'],
  ['USED', 'duplicate rejected'],
  ['FORGED', 'signature mismatch'],
  ['WRONG EVENT', 'genuine, elsewhere'],
  ['UNKNOWN', 'no registration'],
  ['CANCELLED', 'revoked by organizer'],
  ['ADMIT*', 'provisional · offline'],
];

function Ticker() {
  const row = [...TICKER, ...TICKER];
  return (
    <div className="ticker" aria-label="Every scan ends in one of these verdicts">
      <div className="ticker-row" aria-hidden="true">
        {row.map(([w, d], i) => (
          <span key={i}>
            <b>{w}</b> {d}
          </span>
        ))}
      </div>
    </div>
  );
}

function SampleTicket() {
  return (
    <div className="ticket" aria-label="Sample ticket illustration" style={{ maxWidth: 340, transform: 'rotate(-2deg)' }}>
      <div className="ticket-head stack" style={{ '--gap': '6px', padding: '18px 22px' } as React.CSSProperties}>
        <span className="eyebrow" style={{ color: 'var(--signal)' }}>Admit one · sample</span>
        <span className="h3" style={{ fontSize: 20 }}>Spring Hackathon Finals</span>
      </div>
      <div className="ticket-qr" style={{ padding: 22 }}>
        <QrGlyph />
        <span className="code">7KQ2-M9XD-4TRB</span>
      </div>
      <div className="ticket-perf" aria-hidden="true" />
      <dl className="ticket-dl" style={{ padding: '16px 22px 22px' }}>
        <div><dt>Attendee</dt><dd>Your name</dd></div>
        <div><dt>Gate</dt><dd>Any</dd></div>
      </dl>
    </div>
  );
}

/** Decorative QR-like glyph (not a scannable code) — keeps the hero honest. */
function QrGlyph() {
  const n = 21;
  const cells: [number, number][] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!finder(x, y) && rnd() > 0.52) cells.push([x, y]);
  const Finder = ({ x, y }: { x: number; y: number }) => (
    <g>
      <rect x={x} y={y} width="7" height="7" fill="#0d0f0c" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill="#0d0f0c" />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width="200" height="200" aria-hidden="true" shapeRendering="crispEdges">
      <rect x="-1" y="-1" width={n + 2} height={n + 2} fill="#fff" />
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0d0f0c" />)}
      <Finder x={0} y={0} />
      <Finder x={n - 7} y={0} />
      <Finder x={0} y={n - 7} />
    </svg>
  );
}

function MiniVerdict({ tone, word, line, sub }: { tone: 'admit' | 'deny' | 'caution'; word: string; line: string; sub: string }) {
  const Icon = tone === 'admit' ? VERDICTS.accepted.icon : tone === 'deny' ? VERDICTS.duplicate.icon : TriangleAlert;
  return (
    <div className={`verdict verdict-${tone}`} style={{ minHeight: 0, padding: 14, gap: '4px 12px', width: '100%', maxWidth: 360 }}>
      <div className="verdict-icon" style={{ width: 40, height: 40, borderRadius: 10 }}>
        <Icon aria-hidden="true" style={{ width: 22, height: 22 }} />
      </div>
      <div>
        <div className="verdict-word" style={{ fontSize: 22 }}>{word}</div>
        <div className="small">{line}</div>
      </div>
      <div className="verdict-meta mono" style={{ fontSize: 12 }}>{sub}</div>
    </div>
  );
}

export function Landing() {
  return (
    <div>
      <header className="l-nav">
        <div className="container l-nav-inner">
          <Brand />
          <nav className="l-nav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#scanner">Gate scanner</a>
            <a href="#offline">Offline mode</a>
            <a href="#security">Security</a>
          </nav>
          <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
            <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
            <Link to="/login" className="btn btn-primary btn-sm">Try the demo</Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="container hero">
          <div className="stack" style={{ '--gap': '24px' } as React.CSSProperties}>
            <span className="eyebrow">Event entry for college fests, hackathons &amp; seminars</span>
            <h1 className="display">Every ticket scanned once. Every fake caught at the gate.</h1>
            <p className="lead" style={{ maxWidth: 560 }}>
              GateGuard issues cryptographically signed QR tickets, checks them in with a phone camera in under a second, and keeps a live,
              server-verified attendance count — even across several gates.
            </p>
            <div className="row">
              <Link to="/login" className="btn btn-primary btn-lg">
                Open the live demo <ArrowRight aria-hidden="true" />
              </Link>
              <Link to="/e/technova-demo" className="btn btn-outline btn-lg">
                Register for the demo event
              </Link>
            </div>
            <p className="xs muted">The demo is a shared, clearly-labelled sandbox with fictional attendees.</p>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <SampleTicket />
            <div className="stack" style={{ '--gap': '10px', width: '100%', alignItems: 'center', marginTop: -28 } as React.CSSProperties}>
              <MiniVerdict tone="admit" word="ADMIT" line="Diya Iyer · AI & DS" sub="7KQ2-M9XD-4TRB · Main gate" />
              <MiniVerdict tone="deny" word="USED" line="Already checked in" sub="First entry 10:42 · Library gate" />
            </div>
          </div>
        </section>

        <Ticker />

        <section className="container section" id="problem" aria-labelledby="problem-h">
          <div className="split">
            <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
              <span className="eyebrow">The problem</span>
              <h2 id="problem-h" className="h1">The entrance is where events fall apart.</h2>
              <p className="lead">Registration is easy. Letting the right people in — quickly, once, at several doors — is not.</p>
            </div>
            <div className="feature-list">
              {[
                [Users, 'Printed lists and ticking names', 'Slow queues, and no idea how many people are actually inside.'],
                [Fingerprint, 'Screenshots and edited QR codes', 'A forwarded ticket gets in twice; a doctored one looks just as real.'],
                [Gauge, 'Two gates, two volunteers, no shared truth', 'The same ticket admitted at the main gate and the side gate.'],
                [WifiOff, 'Campus Wi-Fi that drops at the worst time', 'Most apps either stop working or quietly pretend nothing happened.'],
              ].map(([Icon, t, d]) => {
                const I = Icon as typeof Users;
                return (
                  <div key={t as string}>
                    <I aria-hidden="true" />
                    <div>
                      <h3 className="h3">{t as string}</h3>
                      <p className="muted small">{d as string}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="section inverted" id="how" aria-labelledby="how-h">
          <div className="container stack" style={{ '--gap': '40px' } as React.CSSProperties}>
            <div className="stack" style={{ '--gap': '12px', maxWidth: 640 } as React.CSSProperties}>
              <span className="eyebrow">How it works</span>
              <h2 id="how-h" className="h1">From sign-up to doors open in four steps.</h2>
            </div>
            <ol className="steps" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[
                ['Create the event', 'Venue, time, capacity and the gates you’ll staff.'],
                ['Share one link', 'Attendees register and get a signed QR ticket instantly — or import a CSV.'],
                ['Scan at the gate', 'Volunteers open the scanner on any phone. One scan, one verdict.'],
                ['Watch it live', 'Check-ins, remaining attendees and rejections update every few seconds.'],
              ].map(([t, d], i) => (
                <li key={t} className="step" style={{ borderColor: 'var(--signal)' }}>
                  <div className="step-n" style={{ color: 'var(--signal)' }}>0{i + 1}</div>
                  <h3 className="h3" style={{ marginTop: 12 }}>{t}</h3>
                  <p className="small muted" style={{ marginTop: 6 }}>{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="container section" id="scanner" aria-labelledby="scan-h">
          <div className="split">
            <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
              <span className="eyebrow">Gate scanner</span>
              <h2 id="scan-h" className="h1">A verdict you can read from arm’s length.</h2>
              <p className="lead">
                A full-width result with a word, an icon and a reason — never colour alone — plus a sound and a buzz. Holding a QR in front of the
                camera never double-submits, and a typed code works when a screen is cracked.
              </p>
              <p className="small muted">
                Duplicate prevention is enforced on the server with a single atomic update: twenty-five phones scanning the same ticket at the same
                moment produce exactly one check-in. That’s a test in the repo, not a promise.
              </p>
            </div>
            <div className="verdict-grid">
              {RESULT_ORDER.map((r) => {
                const v = VERDICTS[r];
                const Icon = v.icon;
                return (
                  <div key={r} className="verdict-row">
                    <span className={`badge badge-${v.tone}`} style={{ padding: 6 }}>
                      <Icon aria-hidden="true" style={{ width: 18, height: 18 }} />
                    </span>
                    <div>
                      <b>{v.word}</b>
                      <span className="xs muted">{v.help}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="container section" style={{ paddingTop: 0 }} aria-labelledby="inside-h">
          <div className="stack" style={{ '--gap': '24px' } as React.CSSProperties}>
            <div className="stack" style={{ '--gap': '12px', maxWidth: 640 } as React.CSSProperties}>
              <span className="eyebrow">Inside the app</span>
              <h2 id="inside-h" className="h1">Live attendance, from the real database.</h2>
              <p className="lead">Counts come straight from check-in records. No sample charts, no invented numbers.</p>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', '--gap': '20px' } as React.CSSProperties}>
              <figure className="frame" style={{ margin: 0 }}>
                <div className="frame-bar"><i /><i /><i /><span>/app/events/… · live attendance</span></div>
                <img src="/screens/event-live.png" alt="Event page showing registered, checked-in and remaining counts, check-ins over time and gate breakdown" loading="lazy" width="1440" height="1000" style={{ width: '100%', height: 'auto' }} />
              </figure>
              <figure className="frame" style={{ margin: 0 }}>
                <div className="frame-bar"><i /><i /><i /><span>/app/scan/… · gate scanner</span></div>
                <img src="/screens/scanner.png" alt="Gate scanner with camera viewport, an ADMIT verdict and this device’s scan queue" loading="lazy" width="1440" height="1000" style={{ width: '100%', height: 'auto' }} />
              </figure>
            </div>
          </div>
        </section>

        <section className="section" id="offline" style={{ background: 'var(--wash)' }} aria-labelledby="off-h">
          <div className="container split">
            <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
              <span className="eyebrow">Offline mode</span>
              <h2 id="off-h" className="h1">Keeps scanning when the Wi-Fi doesn’t. Honest about what that means.</h2>
              <p className="lead">
                GateGuard installs as an app. Offline, it still checks the ticket’s signature, the event, cancelled and already-used tickets from
                its offline pack, and this gate’s own scans.
              </p>
            </div>
            <div className="stack">
              <div className="panel panel-pad stack" style={{ '--gap': '12px' } as React.CSSProperties}>
                <div className="row" style={{ '--gap': '8px' } as React.CSSProperties}>
                  <CloudOff size={20} aria-hidden="true" />
                  <h3 className="h3">What we don’t claim</h3>
                </div>
                <p className="small">
                  Two gates that are both offline can’t see each other’s scans, so both could admit the same ticket. GateGuard marks every offline
                  admit as <strong>provisional</strong>. When devices reconnect, the server keeps exactly one official check-in and flags the other
                  as an offline conflict for staff to review.
                </p>
              </div>
              <div className="verdict-grid" style={{ gridTemplateColumns: '1fr' }}>
                <MiniVerdict tone="caution" word="ADMIT*" line="Provisional — offline check" sub="Signature valid · will sync when online" />
              </div>
            </div>
          </div>
        </section>

        <section className="container section" id="security" aria-labelledby="sec-h">
          <div className="split">
            <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
              <span className="eyebrow">Security &amp; privacy</span>
              <h2 id="sec-h" className="h1">Built so a clever attendee can’t talk their way past the QR.</h2>
            </div>
            <div className="feature-list">
              {[
                [QrCode, 'Signed, unguessable tickets', 'Each QR carries a 60-bit random code and an Ed25519 signature. Change one character and it reads FORGED.'],
                [ShieldCheck, 'No personal data in the QR', 'Names and emails stay on the server. The ticket page masks the email.'],
                [ScanLine, 'Role-based access, enforced server-side', 'Admins, organizers and gate operators. Operators only scan events they’re assigned to.'],
                [Fingerprint, 'Audit trail', 'Every scan attempt and every administrative change is recorded and exportable as CSV.'],
              ].map(([Icon, t, d]) => {
                const I = Icon as typeof QrCode;
                return (
                  <div key={t as string}>
                    <I aria-hidden="true" />
                    <div>
                      <h3 className="h3">{t as string}</h3>
                      <p className="muted small">{d as string}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="section inverted" aria-labelledby="cta-h">
          <div className="container spread" style={{ alignItems: 'flex-end', gap: 24 }}>
            <div className="stack" style={{ '--gap': '12px', maxWidth: 640 } as React.CSSProperties}>
              <h2 id="cta-h" className="h1">See it work in two minutes.</h2>
              <p className="muted">
                Register for the demo event on your phone, then sign in as the demo gate operator on a laptop and scan your own ticket.
              </p>
            </div>
            <div className="row">
              <Link to="/e/technova-demo" className="btn btn-outline btn-lg" style={{ color: 'var(--paper)', borderColor: '#4a4e52' }}>
                Get a demo ticket
              </Link>
              <Link to="/login" className="btn btn-primary btn-lg">
                Open the demo <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container spread">
          <div className="row" style={{ '--gap': '12px' } as React.CSSProperties}>
            <Brand />
            <span>Open source · MIT licence</span>
          </div>
          <div className="row" style={{ '--gap': '20px' } as React.CSSProperties}>
            <a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
            <Link to="/login">Staff sign-in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
