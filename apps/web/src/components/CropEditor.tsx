import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Crop } from '@squeeze/shared';
import { fullRect, moveRect, resizeRect, toCrop, withAspect, type Handle, type Rect } from '../lib/crop';
import { Segmented } from './Segmented';

type Mode = 'free' | 'original' | 'square' | 'custom';

export type CropAspect = { w: number; h: number };

type CropEditorProps = {
  url: string;
  /** Upright source size, the space crop coordinates live in. */
  width: number;
  height: number;
  initial: Crop | null;
  /** Opens locked to this ratio, e.g. the output size for "crop to fit". */
  aspect: CropAspect | null;
  onApply: (crop: Crop | null) => void;
  onCancel: () => void;
};

const HANDLES: Record<string, Handle> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

const PRESETS: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'free', label: 'FREE' },
  { value: 'original', label: 'ORIGINAL' },
  { value: 'square', label: '1:1' },
];

/** Smallest crop side, in screen pixels, so handles never collapse onto each other. */
const MIN_SCREEN_PX = 24;

const RatioField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
  <input
    className="crop-ratio-field"
    type="number"
    inputMode="numeric"
    min={1}
    aria-label={label}
    placeholder={label === 'Ratio width' ? 'W' : 'H'}
    value={value}
    onChange={e => onChange(e.target.value)}
  />
);

export const CropEditor = ({ url, width, height, initial, aspect, onApply, onCancel }: CropEditorProps) => {
  const [rect, setRect] = useState<Rect>(() => initial ?? fullRect(width, height));
  const [mode, setMode] = useState<Mode>(aspect ? 'custom' : 'free');
  const [ratioW, setRatioW] = useState(aspect ? String(aspect.w) : '');
  const [ratioH, setRatioH] = useState(aspect ? String(aspect.h) : '');
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle | null; x: number; y: number; start: Rect; scale: number } | null>(null);
  // Ratio changes reshape the rect as it was before they began, so typing "200"
  // (a 2:300 sliver on the way) or swapping twice does not wear the size down.
  const shapeBase = useRef<Rect | null>(null);
  // 5% smaller than the compare frame, with the spare height kept below it for the size label.
  const maxW = `min(95%, calc(95cqh * ${width / height}))`;

  const customRatio = Number(ratioW) / Number(ratioH);
  const ratio =
    mode === 'original' ? width / height : mode === 'square' ? 1 : mode === 'custom' && Number.isFinite(customRatio) && customRatio > 0 ? customRatio : null;

  useEffect(() => frameRef.current?.focus(), []);

  const reshape = (r: number | null) => {
    if (r === null) return;
    shapeBase.current ??= rect;
    setRect(withAspect(shapeBase.current, r, width, height));
  };

  const pickPreset = (next: Mode) => {
    setMode(next);
    reshape(next === 'original' ? width / height : next === 'square' ? 1 : null);
  };

  const changeRatio = (w: string, h: string) => {
    setRatioW(w);
    setRatioH(h);
    setMode('custom');
    const r = Number(w) / Number(h);
    if (Number(w) > 0 && Number(h) > 0) reshape(r);
  };

  // Swapping turns a preset into its custom rotated ratio: 3:2 becomes 2:3.
  const swap = () => {
    if (ratio === null) return;
    const [w, h] = mode === 'original' ? [width, height] : mode === 'custom' ? [Number(ratioW), Number(ratioH)] : [1, 1];
    changeRatio(String(h), String(w));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const handle = target.dataset.handle ? (HANDLES[target.dataset.handle] ?? null) : null;
    if (!handle && !target.closest('.crop-box')) return;
    const r = e.currentTarget.getBoundingClientRect();
    shapeBase.current = null;
    drag.current = { handle, x: e.clientX, y: e.clientY, start: rect, scale: width / r.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * d.scale;
    const dy = (e.clientY - d.y) * d.scale;
    setRect(
      d.handle
        ? resizeRect(d.start, d.handle, dx, dy, width, height, MIN_SCREEN_PX * d.scale, ratio)
        : moveRect(d.start, dx, dy, width, height),
    );
  };

  const onFrameKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    // One screen pixel per press, ten with Shift. Also keeps arrows from switching queue images.
    const px = ((e.shiftKey ? 10 : 1) * width) / e.currentTarget.getBoundingClientRect().width;
    shapeBase.current = null;
    setRect(prev => moveRect(prev, step[0]! * px, step[1]! * px, width, height));
    e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onCancel();
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) onApply(toCrop(rect, width, height));
    else return;
    e.preventDefault();
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const size = `${Math.round(rect.width)}×${Math.round(rect.height)}`;

  return (
    <div className="compare" onKeyDown={onKeyDown}>
      <div className="compare-stage" data-mode="crop">
        <div className="crop-bar">
          <div className="crop-aspect">
            <Segmented label="Crop ratio" options={PRESETS} value={mode === 'custom' ? null : mode} onChange={pickPreset} />
            <span className="crop-ratio" data-active={mode === 'custom'}>
              <RatioField label="Ratio width" value={ratioW} onChange={w => changeRatio(w, ratioH)} />
              <span aria-hidden>:</span>
              <RatioField label="Ratio height" value={ratioH} onChange={h => changeRatio(ratioW, h)} />
            </span>
            <button type="button" className="btn-outline crop-swap" title="Swap portrait / landscape" disabled={ratio === null || ratio === 1} onClick={swap}>
              ⇄
            </button>
            <span className="crop-size">{size}</span>
          </div>
          <div className="crop-actions">
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                setRect(fullRect(width, height));
                setMode('free');
                shapeBase.current = null;
              }}
            >
              RESET
            </button>
            <button type="button" className="btn-outline" onClick={onCancel}>
              CANCEL
            </button>
            <button type="button" className="btn-outline crop-apply" onClick={() => onApply(toCrop(rect, width, height))}>
              APPLY ↵
            </button>
          </div>
        </div>
        <div
          ref={frameRef}
          className="crop-frame"
          style={{ maxWidth: maxW, aspectRatio: `${width} / ${height}`, marginBottom: '5cqh' }}
          tabIndex={0}
          role="group"
          aria-label="Crop area, arrows move it"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onFrameKeyDown}
        >
          <img src={url} draggable={false} alt="Original" />
          <div
            className="crop-box"
            style={{ left: pct(rect.left, width), top: pct(rect.top, height), width: pct(rect.width, width), height: pct(rect.height, height) }}
          >
            {Object.keys(HANDLES).map(name => (
              <div key={name} className="crop-handle" data-handle={name} />
            ))}
            <span className="crop-box-size">{size}</span>
          </div>
        </div>
      </div>
      <div className="caption">
        <span>drag the box or its handles to crop</span>
        <span>enter apply · esc cancel</span>
      </div>
    </div>
  );
};
