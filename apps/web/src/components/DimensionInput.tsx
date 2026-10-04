import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MAX_DIMENSION } from '@pressit/shared';

type DimensionInputProps = {
  label: ReactNode;
  value: number | null;
  onCommit: (value: number) => void;
};

const COMMIT_DEBOUNCE_MS = 300;

/**
 * Keeps its own draft text so the field can be cleared while typing. Valid
 * numbers are debounced so a resize/compress doesn't fire on every keystroke;
 * blur restores the applied value.
 */
export const DimensionInput = ({ label, value, onCommit }: DimensionInputProps) => {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!focused) setDraft(value === null ? '' : String(value));
  }, [value, focused]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <label className="dim">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_DIMENSION}
        disabled={value === null}
        value={focused ? draft : value === null ? '' : String(value)}
        onFocus={() => {
          setDraft(value === null ? '' : String(value));
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={e => {
          setDraft(e.target.value);
          clearTimeout(timer.current);
          const n = Number(e.target.value);
          if (e.target.value.length >= 2 && n >= 1) timer.current = setTimeout(() => onCommit(n), COMMIT_DEBOUNCE_MS);
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          clearTimeout(timer.current);
          const n = Number(e.currentTarget.value);
          if (e.currentTarget.value !== '' && n >= 1) onCommit(n);
          e.currentTarget.blur();
        }}
      />
    </label>
  );
};
