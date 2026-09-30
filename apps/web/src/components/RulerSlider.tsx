import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '../lib/format';

type RulerSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  valueText?: string;
};

/**
 * Tick-mark ruler with a square orange handle, from the Squeeze design.
 * The ruler always spans 0..max so equal values line up across sliders;
 * `min` only clamps (the stretch below it is unreachable).
 */
export const RulerSlider = ({ label, value, min, max, onChange, disabled = false, valueText }: RulerSliderProps) => {
  const dragging = useRef(false);
  const rulerRef = useRef<HTMLDivElement>(null);

  // Native listener: React's onWheel is passive, so it cannot preventDefault page scroll.
  useEffect(() => {
    const el = rulerRef.current;
    if (!el || disabled) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 5;
      onChange(clamp(value + (e.deltaY < 0 ? step : -step), min, max));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [value, min, max, disabled, onChange]);

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / r.width, 0, 1);
    const raw = t * max;
    onChange(clamp(Math.round(raw / 5) * 5, min, max));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPointer(e);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 10 : 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? value + step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? value - step
          : e.key === 'PageUp'
            ? value + 10
            : e.key === 'PageDown'
              ? value - 10
              : e.key === 'Home'
                ? min
                : e.key === 'End'
                  ? max
                  : null;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next, min, max));
  };

  return (
    <div
      ref={rulerRef}
      className="ruler"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled}
      data-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={e => dragging.current && fromPointer(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={onKeyDown}
    >
      <div className="ruler-track" />
      <div className="ruler-handle" style={{ left: `${(value / max) * 100}%` }} />
    </div>
  );
};
