import { useCallback, useMemo, useRef } from 'react';
import { extensionFor } from '@squeeze/shared';
import { Compare } from './components/Compare';
import { DropZone } from './components/DropZone';
import { Queue } from './components/Queue';
import { SettingsPanel } from './components/SettingsPanel';
import { useGlobalImageInput } from './hooks/useGlobalImageInput';
import { useQueueKeys } from './hooks/useQueueKeys';
import { useSqueeze } from './hooks/useSqueeze';
import { formatBytes } from './lib/format';

export const App = () => {
  const squeeze = useSqueeze();
  const { source, output, dims, load, error, notice, working } = squeeze;
  const input = useRef<HTMLInputElement>(null);

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
          <span className="tagline">image press / runs on your machine, nothing leaves it</span>
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
          {source && dims ? (
            <Compare
              originalUrl={source.url}
              outputUrl={output?.url ?? source.url}
              width={dims.w}
              height={dims.h}
              beforeLabel={formatBytes(source.info.size)}
              afterLabel={output ? formatBytes(output.blob.size) : '…'}
              name={source.name}
              extension={extensionFor(source.settings.format)}
              position={squeeze.items.length > 1 ? `${squeeze.items.indexOf(source) + 1}/${squeeze.items.length}` : null}
              onRename={name => squeeze.rename(source.key, name)}
              onFiles={onFiles}
              onRemove={() => squeeze.remove(source.key)}
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
        <SettingsPanel squeeze={squeeze} />
      </main>
    </div>
  );
};
