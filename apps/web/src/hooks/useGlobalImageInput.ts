import { useEffect } from 'react';

/**
 * Accepts images pasted anywhere on the page, and stops the browser from
 * navigating to a file dropped outside the drop targets.
 */
export const useGlobalImageInput = (onImage: (file: File) => void) => {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
      if (file) onImage(file);
    };
    const block = (e: DragEvent) => e.preventDefault();

    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, [onImage]);
};
