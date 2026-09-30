import { useEffect, useRef } from 'react';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

/** Left/right arrows step through the queue. Shift+arrow is left to the compare slider. */
export const useQueueKeys = (keys: string[], activeKey: string | null, select: (key: string) => void) => {
  const state = useRef({ keys, activeKey, select });
  state.current = { keys, activeKey, select };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || isTyping(e.target)) return;
      const { keys, activeKey, select } = state.current;
      if (keys.length < 2) return;
      const at = activeKey ? keys.indexOf(activeKey) : -1;
      const next = keys[Math.min(keys.length - 1, Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1)))];
      if (next && next !== activeKey) select(next);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};
