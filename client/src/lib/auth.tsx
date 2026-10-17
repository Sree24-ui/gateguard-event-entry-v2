import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { LoadingBlock } from '../components/ui';
import { api, ApiError, cachedApi } from './api';
import type { Role, User } from './types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        // Cached so an operator can reopen the scanner while offline; the server still checks the session on every sync.
        return (await cachedApi<{ user: User | null }>('/auth/me', 'gg2.me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.isNetwork) && n < 2,
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('gg2.me');
    qc.clear();
    qc.setQueryData(['me'], null);
  };
}

/** Client-side route guard for UX only — every API route enforces auth and roles on the server. */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { data: me, isLoading, error } = useMe();
  const loc = useLocation();
  if (isLoading)
    return (
      <div className="container page">
        <LoadingBlock />
      </div>
    );
  if (error && !me) {
    return (
      <div className="container page">
        <p className="muted">Can’t reach the server to check your session. If you were scanning, the queue is safe on this device.</p>
      </div>
    );
  }
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (roles && !roles.includes(me.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
