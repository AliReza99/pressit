import { useEffect, useState, type ReactNode } from 'react';
import { extensionFor, type OutputFormat } from '@squeeze/shared';
import { QUALITY_MAX, QUALITY_MIN, SCALE_MAX, SCALE_MIN, type Squeeze } from '../hooks/useSqueeze';
import { formatBytes } from '../lib/format';
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

const qualityNote = (q: number) => (q > 85 ? 'high' : q > 50 ? 'balanced' : 'aggressive');

export const SettingsPanel = ({ squeeze }: { squeeze: Squeeze }) => {
  const { source, output, dims, scale, isCustomSize, lock, quality, format, keepExif } = squeeze;
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
          <div className="dims">
            <DimensionInput label="WIDTH PX" value={dims?.w ?? null} onCommit={v => squeeze.setDimension('w', v)} />
            <button type="button" className="lock" aria-pressed={lock} title="Preserve aspect ratio" onClick={squeeze.toggleLock}>
              {lock ? 'LOCK' : 'FREE'}
            </button>
            <DimensionInput label="HEIGHT PX" value={dims?.h ?? null} onCommit={v => squeeze.setDimension('h', v)} />
          </div>
          <div className="note">{lock ? 'aspect ratio preserved' : 'ratio unlocked, image may stretch'}</div>
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
          DOWNLOAD {extensionFor(format).toUpperCase()} ↓
        </button>
        {squeeze.items.length > 1 && (
          <div className="batch">
            <button type="button" className="download download-alt" disabled={squeeze.readyCount === 0} onClick={() => void squeeze.downloadAll()}>
              DOWNLOAD ALL ({squeeze.readyCount}/{squeeze.items.length}) ↓
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
