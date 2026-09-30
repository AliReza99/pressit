import { useCallback, useRef } from 'react';
import { Compare } from './components/Compare';
import { DropZone } from './components/DropZone';
import { SettingsPanel } from './components/SettingsPanel';
import { useGlobalImageInput } from './hooks/useGlobalImageInput';
import { useSqueeze } from './hooks/useSqueeze';
import { formatBytes } from './lib/format';

export const App = () => {
  const squeeze = useSqueeze();
  const { source, output, dims, load, error, working } = squeeze;
  const input = useRef<HTMLInputElement>(null);

  const pick = useCallback(() => input.current?.click(), []);
  const onFile = useCallback((file: File | undefined) => void load(file), [load]);
  useGlobalImageInput(onFile);

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
          + NEW IMAGE
        </button>
      </header>

      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={e => {
          onFile(e.target.files?.[0]);
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
              fileName={source.info.name}
              onFile={onFile}
            />
          ) : (
            <DropZone onPick={pick} onFile={onFile} uploading={squeeze.uploading} />
          )}
          <div className="status" role="status" aria-live="polite">
            {error ? <span className="status-error">{error}</span> : working ? 'squeezing…' : null}
          </div>
        </div>
        <SettingsPanel squeeze={squeeze} />
      </main>
    </div>
  );
};
