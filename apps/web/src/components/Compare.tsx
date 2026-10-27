import { useEffect, useState } from 'react';
import { ImageCompare, type ImageCompareLayout } from '@pressit/image-compare';
import type { Crop } from '@pressit/shared';
import { cropImageStyle } from '../lib/crop';
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

const LAYOUT_KEY = 'pressit:compare-layout';

const readLayout = (): ImageCompareLayout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'side' ? 'side' : 'slider';
  } catch {
    return 'slider';
  }
};

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
  const [layout, setLayout] = useState(readLayout);
  const { over, handlers } = useDragOver(onFiles);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // Storage unavailable: the layout just won't persist.
    }
  }, [layout]);

  return (
    <div className="compare" {...handlers}>
      <ImageCompare
        className={over ? 'compare-over' : undefined}
        before={originalUrl}
        after={outputUrl}
        width={width}
        height={height}
        beforeStyle={cropImageStyle(crop, sourceWidth, sourceHeight) ?? undefined}
        beforeLabel={`BEFORE · ${beforeLabel}`}
        afterLabel={`AFTER · ${afterLabel}`}
        layout={layout}
        onLayoutChange={setLayout}
        // Plain arrows switch queue images (see useQueueKeys).
        splitKeys="shift-arrows"
        tools={
          <>
            <button type="button" className="ic-tool" aria-label="Download" title="Download" disabled={!canDownload} onClick={onDownload}>
              <DownloadIcon />
            </button>
            <button type="button" className="ic-tool" aria-label={crop ? 'Edit crop' : 'Crop'} title={crop ? 'Edit crop' : 'Crop'} onClick={onCrop}>
              <CropIcon />
            </button>
            <button type="button" className="ic-tool" aria-label={`Remove ${name}.${extension}`} title="Remove" onClick={onRemove}>
              ×
            </button>
          </>
        }
      />
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
