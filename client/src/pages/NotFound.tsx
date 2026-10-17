import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Brand, EmptyState } from '../components/ui';

export function NotFound() {
  return (
    <div className="container page stack" style={{ '--gap': '32px', maxWidth: 640 } as React.CSSProperties}>
      <Brand />
      <main id="main">
        <EmptyState icon={Compass} title="This page doesn’t exist" action={<Link className="btn btn-dark" to="/">Back to home</Link>}>
          The link may be mistyped, or the event or ticket may have been removed.
        </EmptyState>
      </main>
    </div>
  );
}
