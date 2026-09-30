import { useEffect, useState } from 'react';
import { MAX_DIMENSION } from '@squeeze/shared';

type DimensionInputProps = {
  label: string;
  value: number | null;
  onCommit: (value: number) => void;
};

/**
 * Keeps its own draft text so the field can be cleared while typing. Valid
 * numbers apply immediately; blur restores the applied value.
 */
export const DimensionInput = ({ label, value, onCommit }: DimensionInputProps) => {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value === null ? '' : String(value));
  }, [value, focused]);

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
          const n = Number(e.target.value);
          if (e.target.value !== '' && n >= 1) onCommit(n);
        }}
        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  );
};
