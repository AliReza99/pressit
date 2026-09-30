import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extensionFor, type Crop } from '@squeeze/shared';
import { Compare } from './components/Compare';
import { CropEditor, type CropAspect } from './components/CropEditor';
import { DropZone } from './components/DropZone';
import { Queue } from './components/Queue';
import { SettingsPanel } from './components/SettingsPanel';
import { useGlobalImageInput } from './hooks/useGlobalImageInput';
import { useQueueKeys } from './hooks/useQueueKeys';
import { useSqueeze } from './hooks/useSqueeze';
import { fitAspect, fullRect, sameCrop, toCrop } from './lib/crop';
import { formatBytes } from './lib/format';

type Cropping = { initial: Crop | null; aspect: CropAspect | null };

export const App = () => {
  const squeeze = useSqueeze();
  const { source, output, dims, crop, load, error, notice, working } = squeeze;
  const input = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<Cropping | null>(null);

  // The editor belongs to the image it was opened on.
  useEffect(() => setCropping(null), [squeeze.activeKey]);

  // An output made for an earlier crop would be framed wrong, so it waits for the new one.
  const shown = output && sameCrop(output.crop, crop) ? output : null;

  const openCrop = () => setCropping({ initial: crop, aspect: null });

  // Largest crop at the output's ratio inside the current one, so a free
  // width × height stops stretching the image.
  const cropToFit = () => {
    if (!source || !dims) return;
    const within = crop ?? fullRect(source.info.width, source.info.height);
    const fit = fitAspect(within, dims.w / dims.h);
    setCropping({ initial: toCrop(fit, source.info.width, source.info.height), aspect: { w: dims.w, h: dims.h } });
  };

  const pick = useCallback(() => input.current?.click(), []);
  const onFiles = useCallback((files: File[]) => void load(files), [load]);
  useGlobalImageInput(onFiles);
  const keys = useMemo(() => squeeze.items.map(i => i.key), [squeeze.items]);
  useQueueKeys(keys, squeeze.activeKey, squeeze.select);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>
            Squeeze<span>.</span>
          </h1>
          <span className="tagline">Make images lighter</span>
        </div>
        <button type="button" className="btn-outline" onClick={pick}>
          + ADD IMAGES
        </button>
      </header>

      <input
        ref={input}
        type="file"
        multiple
        accept="image/*"
        hidden
        onChange={e => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />

      <main className="main">
        <div className="stage">
          {source && dims && cropping ? (
            <CropEditor
              url={source.url}
              width={source.info.width}
              height={source.info.height}
              initial={cropping.initial}
              aspect={cropping.aspect}
              onApply={next => {
                squeeze.setCrop(next);
                setCropping(null);
              }}
              onCancel={() => setCropping(null)}
            />
          ) : source && dims ? (
            <Compare
              originalUrl={source.url}
              outputUrl={shown?.url ?? null}
              width={dims.w}
              height={dims.h}
              sourceWidth={source.info.width}
              sourceHeight={source.info.height}
              crop={crop}
              beforeLabel={formatBytes(source.info.size)}
              afterLabel={shown ? formatBytes(shown.blob.size) : '…'}
              name={source.name}
              extension={extensionFor(source.settings.format)}
              position={squeeze.items.length > 1 ? `${squeeze.items.indexOf(source) + 1}/${squeeze.items.length}` : null}
              onRename={name => squeeze.rename(source.key, name)}
              onFiles={onFiles}
              onRemove={() => squeeze.remove(source.key)}
              onCrop={openCrop}
              onDownload={squeeze.download}
              canDownload={!!squeeze.output}
            />
          ) : (
            <div className="compare">
              <DropZone onPick={pick} onFiles={onFiles} uploading={squeeze.uploading} />
              {/* Reserve the filename caption so the layout doesn't shift once an image is chosen. */}
              <div className="caption" aria-hidden>
                &nbsp;
              </div>
            </div>
          )}
          <Queue squeeze={squeeze} onPick={pick} onFiles={onFiles} />
          <div className="status" role="status" aria-live="polite">
            {error ? <span className="status-error">{error}</span> : (notice ?? (working ? 'squeezing…' : null))}
          </div>
        </div>
        <SettingsPanel squeeze={squeeze} onCropToFit={cropToFit} />
      </main>
    </div>
  );
};
