import { useState, type DragEvent } from 'react';

type DropZoneProps = {
  onPick: () => void;
  onFile: (file: File | undefined) => void;
  uploading: boolean;
};

export const useDragOver = (onFile: (file: File | undefined) => void) => {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        // Ignore leave events fired when moving between child elements.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        setOver(false);
        onFile(e.dataTransfer.files[0]);
      },
    },
  };
};

export const DropZone = ({ onPick, onFile, uploading }: DropZoneProps) => {
  const { over, handlers } = useDragOver(onFile);

  return (
    <button type="button" className="dropzone" data-over={over} onClick={onPick} aria-busy={uploading} {...handlers}>
      <span className="dropzone-blocks" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="dropzone-title">
        {uploading ? (
          <>
            Reading
            <br />
            your image…
          </>
        ) : (
          <>
            Drop an image
            <br />
            to shrink it
          </>
        )}
      </span>
      <span className="dropzone-sub">
        or click to browse / paste from clipboard
        <br />
        JPG · PNG · WebP · GIF
      </span>
    </button>
  );
};
