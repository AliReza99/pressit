type SegmentedProps<T extends string | number | boolean> = {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
};

export const Segmented = <T extends string | number | boolean>({ label, options, value, onChange }: SegmentedProps<T>) => (
  <div className="segmented" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
    {options.map(o => (
      <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
        {o.label}
      </button>
    ))}
  </div>
);
