import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '../lib/format';
import { useDragOver } from './DropZone';

type CompareProps = {
  originalUrl: string;
  outputUrl: string;
  width: number;
  height: number;
  beforeLabel: string;
  afterLabel: string;
  fileName: string;
  onFiles: (files: File[]) => void;
};

export const Compare = ({ originalUrl, outputUrl, width, height, beforeLabel, afterLabel, fileName, onFiles }: CompareProps) => {
  const [split, setSplit] = useState(50);
  const dragging = useRef(false);
  const { over, handlers } = useDragOver(onFiles);
  // The stage is a size container filling the available height; cap width so the frame never exceeds it.
  const maxW = `min(100%, calc(100cqh * ${width / height}))`;

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSplit(clamp(((e.clientX - r.left) / r.width) * 100, 0, 100));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') setSplit(s => clamp(s - step, 0, 100));
    else if (e.key === 'ArrowRight') setSplit(s => clamp(s + step, 0, 100));
    else return;
    e.preventDefault();
  };

  return (
    <div className="compare" {...handlers}>
      <div className="compare-stage" data-over={over}>
        <div
          className="compare-frame"
          style={{ maxWidth: maxW, aspectRatio: `${width} / ${height}` }}
          role="slider"
          tabIndex={0}
          aria-label="Before and after comparison"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split)}
          onPointerDown={e => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={e => dragging.current && fromPointer(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          onKeyDown={onKeyDown}
        >
          <img src={originalUrl} draggable={false} alt="Original" />
          <img src={outputUrl} draggable={false} alt="Compressed" style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
          <div className="compare-divider" style={{ left: `${split}%` }}>
            <div className="compare-knob">◂▸</div>
          </div>
          <div className="tag tag-before">BEFORE · {beforeLabel}</div>
          <div className="tag tag-after">AFTER · {afterLabel}</div>
        </div>
      </div>
      <div className="caption">
        <span>{fileName}</span>
        <span>drag the slider to compare · zoom is fit-to-view</span>
      </div>
    </div>
  );
};
