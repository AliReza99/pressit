import { useEffect, useState, type ReactNode } from 'react';
import { extensionFor, type OutputFormat } from '@squeeze/shared';
import { QUALITY_MAX, QUALITY_MIN, SCALE_MAX, SCALE_MIN, type Squeeze } from '../hooks/useSqueeze';
import { formatBytes } from '../lib/format';
import { DownloadIcon } from './Compare';
import { DimensionInput } from './DimensionInput';
import { RulerSlider } from './RulerSlider';
import { Segmented } from './Segmented';

const FORMATS: ReadonlyArray<{ value: OutputFormat; label: string }> = [
  { value: 'jpeg', label: 'JPG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'png', label: 'PNG' },
];
const EXIF_OPTIONS = [
  { value: false, label: 'STRIP' },
  { value: true, label: 'KEEP' },
];

const Section = ({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) => (
  <section className="panel-section">
    <div className="panel-head">
      <span>{title}</span>
      {meta !== undefined && <span>{meta}</span>}
    </div>
    {children}
  </section>
);

const COLLAPSED_KEY = 'squeeze:settings-collapsed';

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};

/** Field label with the change from the original, e.g. "−50%", once the value differs. */
const DimLabel = ({ text, from, to }: { text: string; from?: number; to?: number }) => {
  const pct = from && to ? Math.round((to / from - 1) * 100) : 0;
  return (
    <span className="dim-label">
      <span>{text}</span>
      {pct !== 0 && <span>{pct > 0 ? `+${pct}` : `−${-pct}`}%</span>}
    </span>
  );
};

/** True when width × height is not the base ratio, so the output would be stretched. */
const stretches = (dims: { w: number; h: number }, base: { w: number; h: number }) =>
  Math.abs(Math.log((dims.w / dims.h) * (base.h / base.w))) > 0.01;

const qualityNote = (q: number) => (q > 85 ? 'high' : q > 50 ? 'balanced' : 'aggressive');

export const SettingsPanel = ({ squeeze, onCropToFit }: { squeeze: Squeeze; onCropToFit: () => void }) => {
  const { source, output, dims, base, crop, scale, isCustomSize, lock, quality, format, keepExif } = squeeze;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const info = source?.info;
  const lossless = format === 'png';

  const origSize = info?.size ?? 0;
  const outSize = output?.blob.size ?? 0;
  const saved = origSize && output ? Math.round((1 - outSize / origSize) * 100) : 0;

  const exifStatus = !info ? '' : info.exifBytes ? `FOUND ${formatBytes(info.exifBytes)}` : 'NONE FOUND';
  const exifNote = !keepExif
    ? 'camera, GPS and date data removed'
    : !info
      ? 'metadata copied to output'
      : info.exifBytes
        ? 'metadata copied to output (orientation applied)'
        : 'source has no EXIF to keep';

  const formatLabel = FORMATS.find(f => f.value === format)?.label ?? format.toUpperCase();
  const sizeSummary = isCustomSize && dims ? `${dims.w}×${dims.h}` : `${scale}%`;
  const summary = [sizeSummary, lossless ? 'LOSSLESS' : `Q${quality}`, keepExif ? 'EXIF' : 'NO EXIF', formatLabel].join(' · ');

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // Storage unavailable: collapsed state just won't persist.
    }
  }, [collapsed]);

  return (
    <aside className="panel">
      <button
        type="button"
        className="panel-toggle"
        aria-expanded={!collapsed}
        aria-controls="compression-settings"
        onClick={() => setCollapsed(c => !c)}
      >
        <span>SETTINGS</span>
        <span className="panel-toggle-meta">
          {collapsed && <span className="panel-toggle-summary">{summary}</span>}
          <span aria-hidden>{collapsed ? '+' : '−'}</span>
        </span>
      </button>

      <div id="compression-settings" hidden={collapsed}>
        <Section title="SIZE" meta={`${scale}%`}>
          <RulerSlider label="Scale" value={scale} min={SCALE_MIN} max={SCALE_MAX} onChange={squeeze.setScale} valueText={`${scale}%`} />
        </Section>

        <Section title="QUALITY" meta={lossless ? 'LOSSLESS' : `${quality}%`}>
          <RulerSlider
            label="Quality"
            value={quality}
            min={QUALITY_MIN}
            max={QUALITY_MAX}
            onChange={squeeze.setQuality}
            disabled={lossless}
            valueText={lossless ? 'lossless' : `${quality} of 100`}
          />
          <div className="note note-spread">
            <span>smallest</span>
            <span>{lossless ? 'PNG ignores quality' : qualityNote(quality)}</span>
            <span>sharpest</span>
          </div>
        </Section>

        <Section title="DIMENSIONS" meta={dims ? `${dims.w}×${dims.h}` : undefined}>
          <div className="dims">
            <label className="dim dim-original">
              {crop ? 'CROP W' : 'ORIGINAL W'}
              <input type="number" disabled value={base?.w ?? ''} />
            </label>
            <span className="dims-arrow" aria-hidden>
              ↓
            </span>
            <label className="dim dim-original">
              {crop ? 'CROP H' : 'ORIGINAL H'}
              <input type="number" disabled value={base?.h ?? ''} />
            </label>
            <DimensionInput
              label={<DimLabel text="WIDTH PX" from={base?.w} to={dims?.w} />}
              value={dims?.w ?? null}
              onCommit={v => squeeze.setDimension('w', v)}
            />
            <button type="button" className="lock" aria-pressed={lock} title="Preserve aspect ratio" onClick={squeeze.toggleLock}>
              {lock ? 'LOCK' : 'FREE'}
            </button>
            <DimensionInput
              label={<DimLabel text="HEIGHT PX" from={base?.h} to={dims?.h} />}
              value={dims?.h ?? null}
              onCommit={v => squeeze.setDimension('h', v)}
            />
          </div>
          {!lock && dims && base && stretches(dims, base) ? (
            <div className="note note-spread">
              <span>ratio differs, image will stretch</span>
              <button type="button" className="note-action" onClick={onCropToFit}>
                CROP TO FIT
              </button>
            </div>
          ) : (
            <div className="note">{lock ? 'aspect ratio preserved' : 'ratio unlocked'}</div>
          )}
        </Section>

        <Section title="EXIF" meta={exifStatus}>
          <Segmented label="EXIF metadata" options={EXIF_OPTIONS} value={keepExif} onChange={squeeze.setKeepExif} />
          <div className="note">{exifNote}</div>
        </Section>

        <Section title="FORMAT">
          <Segmented label="Output format" options={FORMATS} value={format} onChange={squeeze.setFormat} />
        </Section>
      </div>

      <section className="panel-section panel-result">
        <div className="bars">
          <div className="bar-row">
            <span>
              <span className="bar-label">BEFORE</span>
              {info && <span className="bar-px">{info.width}×{info.height}</span>}
            </span>
            <span>{formatBytes(origSize)}</span>
          </div>
          <div className="bar bar-before">
            <div style={{ width: info ? '100%' : '0%' }} />
          </div>
          <div className="bar-row bar-row-after">
            <span>
              <span className="bar-label">AFTER</span>
              {dims && <span className="bar-px">{output?.width || dims.w}×{output?.height || dims.h}</span>}
            </span>
            <span>{formatBytes(outSize)}</span>
          </div>
          <div className="bar bar-after">
            <div style={{ width: origSize ? `${Math.min(100, (outSize / origSize) * 100)}%` : '0%' }} />
          </div>
        </div>
        <div className="saved">
          <span>{saved < 0 ? 'LARGER BY' : 'SAVED'}</span>
          <span className="saved-value">{saved < 0 ? `+${-saved}` : saved}%</span>
        </div>
        <button type="button" className="download" disabled={!output} onClick={squeeze.download}>
          DOWNLOAD {extensionFor(format).toUpperCase()} <DownloadIcon />
        </button>
        {squeeze.items.length > 1 && (
          <div className="batch">
            <button type="button" className="download download-alt" disabled={squeeze.readyCount === 0} onClick={() => void squeeze.downloadAll()}>
              DOWNLOAD ALL ({squeeze.readyCount}/{squeeze.items.length}) <DownloadIcon />
            </button>
            <button type="button" className="btn-outline" onClick={squeeze.applyToAll}>
              APPLY THESE SETTINGS TO ALL
            </button>
          </div>
        )}
      </section>
    </aside>
  );
};
