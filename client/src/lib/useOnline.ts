import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Browser connectivity. A `true` here still doesn't guarantee the API is reachable — callers handle request failures. */
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
