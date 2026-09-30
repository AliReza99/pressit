import { useEffect } from 'react';
import type { Item, Squeeze } from '../hooks/useSqueeze';
import { useDragOver } from './DropZone';

const savedLabel = ({ info, output, working, error }: Item) => {
  if (error) return 'FAILED';
  if (!output || working) return '…';
  const saved = Math.round((1 - output.blob.size / info.size) * 100);
  return saved < 0 ? `+${-saved}%` : `-${saved}%`;
};

export const Queue = ({ squeeze, onPick, onFiles }: { squeeze: Squeeze; onPick: () => void; onFiles: (files: File[]) => void }) => {
  const { items, activeKey } = squeeze;
  const { over, handlers } = useDragOver(onFiles);
  useEffect(() => {
    document.querySelector('.queue-item[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey]);
  const busy = items.filter(i => i.working || (!i.output && !i.error)).length;

  return (
    <section className="queue" aria-label="Queue">
      <div className="queue-head">
        <span>
          QUEUE · {items.length === 0 ? 'EMPTY' : `${items.length} ${items.length === 1 ? 'IMAGE' : 'IMAGES'} · ${busy ? `${busy} SQUEEZING` : 'ALL READY'}`}
        </span>
        {items.length > 0 && (
          <button type="button" className="queue-clear" onClick={squeeze.clear}>
            CLEAR ALL
          </button>
        )}
      </div>
      <ul className="queue-list">
        {items.map(item => (
          <li key={item.key} className="queue-item" data-active={item.key === activeKey} data-failed={item.error !== null}>
            <button type="button" className="queue-pick" aria-pressed={item.key === activeKey} title={item.file.name} onClick={() => squeeze.select(item.key)}>
              <img src={item.url} alt="" draggable={false} />
              <span className="queue-label">{savedLabel(item)}</span>
            </button>
            <button type="button" className="queue-remove" aria-label={`Remove ${item.file.name}`} onClick={() => squeeze.remove(item.key)}>
              ×
            </button>
          </li>
        ))}
        <li className="queue-item">
          <button type="button" className="queue-add" data-over={over} aria-label="Add images" onClick={onPick} {...handlers}>
            <span aria-hidden>+</span>
            <span>ADD IMAGES</span>
          </button>
        </li>
      </ul>
    </section>
  );
};
