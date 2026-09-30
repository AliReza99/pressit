import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '../lib/format';
import { useDragOver } from './DropZone';

type CompareProps = {
  originalUrl: string;
  outputUrl: string;
  width: number;
  height: number;
  beforeLabel: string;
  afterLabel: string;
  name: string;
  extension: string;
  position: string | null;
  onRename: (name: string) => void;
  onFiles: (files: File[]) => void;
  onRemove: () => void;
};

const MAX_ZOOM = 16;
const SPLIT_GRAB_PX = 24;

type View = { zoom: number; x: number; y: number };
const FIT: View = { zoom: 1, x: 0, y: 0 };

// Keep the zoomed image covering the frame: offsets range from (1 - zoom) * size up to 0.
const clampView = (v: View, w: number, h: number): View => ({
  zoom: v.zoom,
  x: clamp(v.x, w * (1 - v.zoom), 0),
  y: clamp(v.y, h * (1 - v.zoom), 0),
});

const NameField = ({ value, onCommit }: { value: string; onCommit: (name: string) => void }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = (save: boolean) => {
    if (save && draft !== null) onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      className="name-field"
      aria-label="File name for download"
      title="Click to rename"
      spellCheck={false}
      value={draft ?? value}
      size={Math.max(4, (draft ?? value).length)}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          finish(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
};

export const Compare = ({ originalUrl, outputUrl, width, height, beforeLabel, afterLabel, name, extension, position, onRename, onFiles, onRemove }: CompareProps) => {
  const [split, setSplit] = useState(50);
  const [view, setView] = useState<View>(FIT);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'split' | 'pan'; x: number; y: number } | null>(null);
  const { over, handlers } = useDragOver(onFiles);
  // The stage is a size container filling the available height; cap width so the frame never exceeds it.
  const maxW = `min(100%, calc(100cqh * ${width / height}))`;

  useEffect(() => setView(FIT), [originalUrl]);

  // Wheel zooms about the cursor. Needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      setView(v => {
        const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.002), 1, MAX_ZOOM);
        const k = zoom / v.zoom;
        return clampView({ zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, r.width, r.height);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const splitFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSplit(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const nearSplit = Math.abs(e.clientX - r.left - (split / 100) * r.width) <= SPLIT_GRAB_PX;
    // Zoomed in, dragging pans; grab the divider to move the slider instead.
    const mode = view.zoom === 1 || nearSplit ? 'split' : 'pan';
    drag.current = { mode, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === 'split') splitFromPointer(e);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'split') return splitFromPointer(e);
    const { width: w, height: h } = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    setView(v => clampView({ ...v, x: v.x + dx, y: v.y + dy }, w, h));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Plain arrows switch queue images (see useQueueKeys); Shift+arrow moves the slider.
    if (!e.shiftKey) return;
    if (e.key === 'ArrowLeft') setSplit(s => clamp(s - 5, 0, 100));
    else if (e.key === 'ArrowRight') setSplit(s => clamp(s + 5, 0, 100));
    else return;
    e.preventDefault();
  };

  const layerStyle = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` };

  return (
    <div className="compare" {...handlers}>
      <div className="compare-stage" data-over={over}>
        <button type="button" className="compare-remove" aria-label={`Remove ${name}.${extension}`} onClick={onRemove}>
          ×
        </button>
        <div
          ref={frameRef}
          className="compare-frame"
          data-zoomed={view.zoom > 1}
          style={{ maxWidth: maxW, aspectRatio: `${width} / ${height}` }}
          role="slider"
          tabIndex={0}
          aria-label="Before and after comparison"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onDoubleClick={() => setView(FIT)}
          onKeyDown={onKeyDown}
        >
          <div className="compare-layer" style={layerStyle}>
            <img src={originalUrl} draggable={false} alt="Original" />
          </div>
          <div className="compare-clip" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
            <div className="compare-layer" style={layerStyle}>
              <img src={outputUrl} draggable={false} alt="Compressed" />
            </div>
          </div>
          <div className="compare-divider" style={{ left: `${split}%` }}>
            <div className="compare-knob">◂▸</div>
          </div>
          <div className="tag tag-before">BEFORE · {beforeLabel}</div>
          <div className="tag tag-after">AFTER · {afterLabel}</div>
        </div>
      </div>
      <div className="caption">
        <span className="caption-name">
          <NameField key={originalUrl} value={name} onCommit={onRename} />
          <span>.{extension}</span>
          {position && <span> ({position})</span>}
        </span>
        <span>drag to compare · wheel zoom</span>
      </div>
    </div>
  );
};
