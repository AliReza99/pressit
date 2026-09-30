import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};

export const useWindowHeight = () => useSyncExternalStore(subscribe, () => window.innerHeight);
