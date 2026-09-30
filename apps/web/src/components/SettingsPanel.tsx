import type { ReactNode } from 'react';
import { extensionFor, type OutputFormat } from '@squeeze/shared';
import { QUALITY_MAX, QUALITY_MIN, SCALE_MAX, SCALE_MIN, type Squeeze } from '../hooks/useSqueeze';
import { formatBytes } from '../lib/format';
import { DimensionInput } from './DimensionInput';
import { RulerSlider } from './RulerSlider';
import { Segmented } from './Segmented';

const PRESETS = [25, 50, 75, 100].map(v => ({ value: v, label: `${v}%` }));
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

const qualityNote = (q: number) => (q > 85 ? 'high' : q > 50 ? 'balanced' : 'aggressive');

export const SettingsPanel = ({ squeeze }: { squeeze: Squeeze }) => {
  const { source, output, dims, scale, isCustomSize, lock, quality, format, keepExif } = squeeze;
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

  return (
    <aside className="panel">
      <Section title="SIZE" meta={info && dims ? `${info.width}×${info.height} → ${dims.w}×${dims.h}` : '—'}>
        <Segmented label="Scale presets" options={PRESETS} value={isCustomSize ? null : scale} onChange={squeeze.setScale} />
        <RulerSlider label="Scale" value={scale} min={SCALE_MIN} max={SCALE_MAX} onChange={squeeze.setScale} valueText={`${scale}%`} />
        <div className="note">{scale}% of original dimensions</div>
        <div className="dims">
          <DimensionInput label="WIDTH PX" value={dims?.w ?? null} onCommit={v => squeeze.setDimension('w', v)} />
          <button type="button" className="lock" aria-pressed={lock} title="Preserve aspect ratio" onClick={squeeze.toggleLock}>
            {lock ? 'LOCK' : 'FREE'}
          </button>
          <DimensionInput label="HEIGHT PX" value={dims?.h ?? null} onCommit={v => squeeze.setDimension('h', v)} />
        </div>
        <div className="note">{lock ? 'aspect ratio preserved' : 'ratio unlocked, image may stretch'}</div>
      </Section>

      <Section title="QUALITY" meta={lossless ? 'LOSSLESS' : `${quality}/100`}>
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

      <Section title="FORMAT">
        <Segmented label="Output format" options={FORMATS} value={format} onChange={squeeze.setFormat} />
      </Section>

      <Section title="EXIF" meta={exifStatus}>
        <Segmented label="EXIF metadata" options={EXIF_OPTIONS} value={keepExif} onChange={squeeze.setKeepExif} />
        <div className="note">{exifNote}</div>
      </Section>

      <section className="panel-section panel-result">
        <div className="bars">
          <div className="bar-row">
            <span>BEFORE</span>
            <span>{formatBytes(origSize)}</span>
          </div>
          <div className="bar bar-before" />
          <div className="bar-row bar-row-after">
            <span>AFTER</span>
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
