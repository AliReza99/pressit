import { useState, type DragEvent } from 'react';

type DropZoneProps = {
  onPick: () => void;
  onFiles: (files: File[]) => void;
  uploading: boolean;
};

export const useDragOver = (onFiles: (files: File[]) => void) => {
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
        onFiles([...e.dataTransfer.files]);
      },
    },
  };
};

export const DropZone = ({ onPick, onFiles, uploading }: DropZoneProps) => {
  const { over, handlers } = useDragOver(onFiles);

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
            your images…
          </>
        ) : (
          <>
            Drop images
            <br />
            to shrink them
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
