import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { Crop } from '@pressit/shared';
import { cropImageStyle } from '../lib/crop';
import { clamp } from '../lib/format';
import { useDragOver } from './DropZone';

type CompareProps = {
  originalUrl: string;
  /** Null until an output matching the current crop is ready; the cropped original stands in. */
  outputUrl: string | null;
  /** Output size, which sets the frame shape. */
  width: number;
  height: number;
  /** Upright source size and crop, used to frame the original like the output. */
  sourceWidth: number;
  sourceHeight: number;
  crop: Crop | null;
  beforeLabel: string;
  afterLabel: string;
  name: string;
  extension: string;
  position: string | null;
  onRename: (name: string) => void;
  onFiles: (files: File[]) => void;
  onRemove: () => void;
  onCrop: () => void;
  onDownload: () => void;
  canDownload: boolean;
};

const MAX_ZOOM = 16;
const SPLIT_GRAB_PX = 24;
const LAYOUT_KEY = 'pressit:compare-layout';

type Layout = 'slider' | 'side';

const readLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'side' ? 'side' : 'slider';
  } catch {
    return 'slider';
  }
};

/** Offsets are fractions of the frame size. */
type View = { zoom: number; x: number; y: number };
const FIT: View = { zoom: 1, x: 0, y: 0 };

/** The slider frame uses pane 0; side by side, BEFORE is pane 0 and AFTER pane 1, each zoomed on its own. */
type Pane = 0 | 1;
const BOTH_FIT: [View, View] = [FIT, FIT];
const paneOf = (el: Element): Pane => ((el as HTMLElement).dataset.pane === '1' ? 1 : 0);

// Keep the zoomed image covering the frame: offsets range from 1 - zoom up to 0.
const clampView = (v: View): View => ({
  zoom: v.zoom,
  x: clamp(v.x, 1 - v.zoom, 0),
  y: clamp(v.y, 1 - v.zoom, 0),
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

const CropIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M4 1v11h11M1 4h11v11" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const DownloadIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M8 1v9M4 6l4 4 4-4M2 14h12" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

// One wide frame split down the middle, like a split-editor icon, so it doesn't read as pause.
const SideBySideIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M1 3h14v10H1zM8 3v10" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const Compare = ({
  originalUrl,
  outputUrl,
  width,
  height,
  sourceWidth,
  sourceHeight,
  crop,
  beforeLabel,
  afterLabel,
  name,
  extension,
  position,
  onRename,
  onFiles,
  onRemove,
  onCrop,
  onDownload,
  canDownload,
}: CompareProps) => {
  const [split, setSplit] = useState(50);
  const [views, setViews] = useState<[View, View]>(BOTH_FIT);
  const [layout, setLayout] = useState(readLayout);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'split' | 'pan'; pane: Pane; x: number; y: number } | null>(null);
  const { over, handlers } = useDragOver(onFiles);
  const ratio = width / height;
  const sourceRatio = sourceWidth / sourceHeight;
  // The stage (and each side-by-side half) is a size container; cap width so the frame never exceeds its height.
  const fit = (r: number) => ({ maxWidth: `min(100%, calc(100cqh * ${r}))`, aspectRatio: String(r) });

  const updateView = (pane: Pane, change: (v: View) => View) =>
    setViews(vs => (pane === 0 ? [change(vs[0]), vs[1]] : [vs[0], change(vs[1])]));

  useEffect(() => setViews(BOTH_FIT), [originalUrl]);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // Storage unavailable: the layout just won't persist.
    }
  }, [layout]);

  // Wheel zooms about the cursor in whichever frame it is over.
  // Needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      const el = (e.target as Element).closest('.compare-frame');
      if (!el) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width;
      const cy = (e.clientY - r.top) / r.height;
      const pane = paneOf(el);
      setViews(vs => {
        const v = vs[pane];
        const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.002), 1, MAX_ZOOM);
        const k = zoom / v.zoom;
        const next = clampView({ zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
        return pane === 0 ? [next, vs[1]] : [vs[0], next];
      });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  const splitFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSplit(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const nearSplit = Math.abs(e.clientX - r.left - (split / 100) * r.width) <= SPLIT_GRAB_PX;
    // Zoomed in, dragging pans; grab the divider to move the slider instead.
    // Side by side there is no slider, so dragging only pans.
    const pane = paneOf(e.currentTarget);
    const zoomed = views[pane].zoom > 1;
    if (layout === 'side' && !zoomed) return;
    const mode = layout === 'slider' && (!zoomed || nearSplit) ? 'split' : 'pan';
    drag.current = { mode, pane, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === 'split') splitFromPointer(e);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'split') return splitFromPointer(e);
    const { width: w, height: h } = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - d.x) / w;
    const dy = (e.clientY - d.y) / h;
    d.x = e.clientX;
    d.y = e.clientY;
    updateView(d.pane, v => clampView({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Plain arrows switch queue images (see useQueueKeys); Shift+arrow moves the slider.
    if (!e.shiftKey) return;
    if (e.key === 'ArrowLeft') setSplit(s => clamp(s - 5, 0, 100));
    else if (e.key === 'ArrowRight') setSplit(s => clamp(s + 5, 0, 100));
    else return;
    e.preventDefault();
  };

  // The layer is the frame's size, so percentage translation is relative to the frame.
  const layerStyle = (v: View) => ({ transform: `translate(${v.x * 100}%, ${v.y * 100}%) scale(${v.zoom})` });
  const croppedStyle = cropImageStyle(crop, sourceWidth, sourceHeight) ?? undefined;
  const pointerHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
    onDoubleClick: (e: MouseEvent<HTMLDivElement>) => updateView(paneOf(e.currentTarget), () => FIT),
  };

  const before = (full: boolean, v: View) => (
    <div className="compare-layer" style={layerStyle(v)}>
      <img src={originalUrl} draggable={false} alt="Original" style={full ? undefined : croppedStyle} />
    </div>
  );
  const after = (v: View) => (
    <div className="compare-layer" style={layerStyle(v)}>
      {outputUrl ? (
        <img src={outputUrl} draggable={false} alt="Compressed" />
      ) : (
        <img src={originalUrl} draggable={false} alt="Compressed, pending" style={croppedStyle} />
      )}
    </div>
  );

  return (
    <div className="compare" {...handlers}>
      <div ref={stageRef} className="compare-stage" data-over={over}>
        <div className="compare-tools">
          <button
            type="button"
            className="compare-tool"
            aria-pressed={layout === 'side'}
            aria-label="Side by side"
            title="Side by side"
            onClick={() => {
              setLayout(l => (l === 'side' ? 'slider' : 'side'));
              setViews(BOTH_FIT);
            }}
          >
            <SideBySideIcon />
          </button>
          <button type="button" className="compare-tool" aria-label="Download" title="Download" disabled={!canDownload} onClick={onDownload}>
            <DownloadIcon />
          </button>
          <button type="button" className="compare-tool" aria-label={crop ? 'Edit crop' : 'Crop'} title={crop ? 'Edit crop' : 'Crop'} onClick={onCrop}>
            <CropIcon />
          </button>
          <button type="button" className="compare-tool" aria-label={`Remove ${name}.${extension}`} title="Remove" onClick={onRemove}>
            ×
          </button>
        </div>
        {layout === 'side' ? (
          <div className="compare-pair">
            <div className="compare-half">
              <div className="tag tag-before">BEFORE · {beforeLabel}</div>
              <div className="compare-half-body">
                <div className="compare-frame" data-layout="side" data-pane="0" data-zoomed={views[0].zoom > 1} style={fit(sourceRatio)} {...pointerHandlers}>
                  {before(true, views[0])}
                </div>
              </div>
            </div>
            <div className="compare-half">
              <div className="tag tag-after">AFTER · {afterLabel}</div>
              <div className="compare-half-body">
                <div className="compare-frame" data-layout="side" data-pane="1" data-zoomed={views[1].zoom > 1} style={fit(ratio)} {...pointerHandlers}>
                  {after(views[1])}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="compare-frame"
            data-pane="0"
            data-zoomed={views[0].zoom > 1}
            style={fit(ratio)}
            role="slider"
            tabIndex={0}
            aria-label="Before and after comparison"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split)}
            onKeyDown={onKeyDown}
            {...pointerHandlers}
          >
            {before(false, views[0])}
            <div className="compare-clip" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
              {after(views[0])}
            </div>
            <div className="compare-divider" style={{ left: `${split}%` }}>
              <div className="compare-knob">◂▸</div>
            </div>
            <div className="tag tag-before">BEFORE · {beforeLabel}</div>
            <div className="tag tag-after">AFTER · {afterLabel}</div>
          </div>
        )}
      </div>
      <div className="caption">
        <span className="caption-name">
          <NameField key={originalUrl} value={name} onCommit={onRename} />
          <span>.{extension}</span>
          {position && <span> ({position})</span>}
        </span>
        <span>{layout === 'side' ? 'wheel zoom · drag to pan' : 'drag to compare · wheel zoom'}</span>
      </div>
    </div>
  );
};
