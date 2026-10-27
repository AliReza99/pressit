import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

export type ImageCompareLayout = 'slider' | 'side';

export type ImageCompareProps = {
  /** Original image url. */
  before: string;
  /** Processed image url. null = pending: `before` shows in its place and the root gets data-pending. */
  after: string | null;
  /** Size of the `after` image; sets the frame's aspect ratio. */
  width: number;
  height: number;
  /** Corner tags, e.g. "Original · 2.4 MB". */
  beforeLabel?: ReactNode;
  afterLabel?: ReactNode;
  /** Extra buttons, top-right, after the built-in layout toggle. Give them class "ic-tool" to match its style. */
  tools?: ReactNode;
  /**
   * Style for the `before` <img> wherever it must line up with `after` (the slider, and the pending
   * after pane), e.g. to show only a cropped region. Side by side, BEFORE shows the whole image.
   */
  beforeStyle?: CSSProperties;
  /** Controlled layout. Omit to let the component manage it. */
  layout?: ImageCompareLayout;
  /** Uncontrolled starting layout. Default 'slider'. */
  defaultLayout?: ImageCompareLayout;
  /** Fires when the built-in toggle is pressed, in both modes. */
  onLayoutChange?: (layout: ImageCompareLayout) => void;
  /** Keys that move the split. Default 'arrows'. Use 'shift-arrows' when plain arrows mean something else on the page. */
  splitKeys?: 'arrows' | 'shift-arrows';
  className?: string;
};

const MAX_ZOOM = 16;
const SPLIT_GRAB_PX = 24;
const SPLIT_KEY_STEP = 5;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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

// One wide frame split down the middle, like a split-editor icon, so it doesn't read as pause.
const SideBySideIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <path d="M1 3h14v10H1zM8 3v10" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const ImageCompare = ({
  before,
  after,
  width,
  height,
  beforeLabel,
  afterLabel,
  tools,
  beforeStyle,
  layout: layoutProp,
  defaultLayout = 'slider',
  onLayoutChange,
  splitKeys = 'arrows',
  className,
}: ImageCompareProps) => {
  const [split, setSplit] = useState(50);
  const [views, setViews] = useState<[View, View]>(BOTH_FIT);
  const [ownLayout, setOwnLayout] = useState(defaultLayout);
  // Side by side, BEFORE is shown whole, so its frame takes the image's own shape once it loads.
  const [beforeRatio, setBeforeRatio] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'split' | 'pan'; pane: Pane; x: number; y: number } | null>(null);
  const layout = layoutProp ?? ownLayout;
  const ratio = width / height;
  // The root (and each side-by-side half) is a size container; cap width so the frame never exceeds its height.
  const fit = (r: number) => ({ maxWidth: `min(100%, calc(100cqh * ${r}))`, aspectRatio: String(r) });

  const updateView = (pane: Pane, change: (v: View) => View) =>
    setViews(vs => (pane === 0 ? [change(vs[0]), vs[1]] : [vs[0], change(vs[1])]));

  useEffect(() => setViews(BOTH_FIT), [before]);

  // Wheel zooms about the cursor in whichever frame it is over.
  // Needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      const el = (e.target as Element).closest('.ic-frame');
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
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  const toggleLayout = () => {
    const next = layout === 'side' ? 'slider' : 'side';
    setOwnLayout(next);
    onLayoutChange?.(next);
    setViews(BOTH_FIT);
  };

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
    if (splitKeys === 'shift-arrows' && !e.shiftKey) return;
    if (e.key === 'ArrowLeft') setSplit(s => clamp(s - SPLIT_KEY_STEP, 0, 100));
    else if (e.key === 'ArrowRight') setSplit(s => clamp(s + SPLIT_KEY_STEP, 0, 100));
    else return;
    e.preventDefault();
  };

  // The layer is the frame's size, so percentage translation is relative to the frame.
  const layerStyle = (v: View) => ({ transform: `translate(${v.x * 100}%, ${v.y * 100}%) scale(${v.zoom})` });
  const pointerHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
    onDoubleClick: (e: MouseEvent<HTMLDivElement>) => updateView(paneOf(e.currentTarget), () => FIT),
  };

  const beforeLayer = (whole: boolean, v: View) => (
    <div className="ic-layer" style={layerStyle(v)}>
      <img
        src={before}
        draggable={false}
        alt="Before"
        style={whole ? undefined : beforeStyle}
        onLoad={e => setBeforeRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
      />
    </div>
  );
  const afterLayer = (v: View) => (
    <div className="ic-layer" style={layerStyle(v)}>
      {after ? (
        <img src={after} draggable={false} alt="After" />
      ) : (
        <img src={before} draggable={false} alt="After, pending" style={beforeStyle} />
      )}
    </div>
  );
  const beforeTag = beforeLabel != null && <div className="ic-tag ic-tag-before">{beforeLabel}</div>;
  const afterTag = afterLabel != null && <div className="ic-tag ic-tag-after">{afterLabel}</div>;

  return (
    <div
      ref={rootRef}
      className={className ? `ic-root ${className}` : 'ic-root'}
      data-layout={layout}
      data-pending={after === null || undefined}
    >
      <div className="ic-tools">
        <button
          type="button"
          className="ic-tool"
          aria-pressed={layout === 'side'}
          aria-label="Side by side"
          title="Side by side"
          onClick={toggleLayout}
        >
          <SideBySideIcon />
        </button>
        {tools}
      </div>
      {layout === 'side' ? (
        <div className="ic-pair">
          <div className="ic-half">
            {beforeTag}
            <div className="ic-half-body">
              <div
                className="ic-frame"
                data-pane="0"
                data-zoomed={views[0].zoom > 1 || undefined}
                style={fit(beforeRatio ?? ratio)}
                {...pointerHandlers}
              >
                {beforeLayer(true, views[0])}
              </div>
            </div>
          </div>
          <div className="ic-half">
            {afterTag}
            <div className="ic-half-body">
              <div
                className="ic-frame"
                data-pane="1"
                data-zoomed={views[1].zoom > 1 || undefined}
                style={fit(ratio)}
                {...pointerHandlers}
              >
                {afterLayer(views[1])}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="ic-frame"
          data-pane="0"
          data-zoomed={views[0].zoom > 1 || undefined}
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
          {beforeLayer(false, views[0])}
          <div className="ic-clip" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
            {afterLayer(views[0])}
          </div>
          <div className="ic-divider" style={{ left: `${split}%` }}>
            <div className="ic-knob">◂▸</div>
          </div>
          {beforeTag}
          {afterTag}
        </div>
      )}
    </div>
  );
};
