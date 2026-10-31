// Photo proof: kids snap a picture of a finished chore; it's shrunk on the device before it's sent.
import { useState } from 'react';
import { CHEERS } from '../../../shared/catalog.ts';
import { Modal } from './Bits.tsx';

const MAX_SIDE = 1024;

/** Thrown when a picked file can't be read as a picture; the message is shown to the kid. */
const UNREADABLE = "That picture couldn't be opened. Try a JPEG or PNG photo (iPhone HEIC photos don't work here).";

/** Decodes a picked file. createImageBitmap first, then a plain <img> for browsers and desktop apps where that fails. */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(UNREADABLE);
    }
  }
}

/** Shrinks a picked photo to at most 1024px on its long side, as a JPEG data: URL. */
export async function shrinkPhoto(file: File): Promise<string> {
  const pic = await decode(file);
  try {
    if (!pic.width || !pic.height) throw new Error(UNREADABLE);
    const scale = Math.min(1, MAX_SIDE / Math.max(pic.width, pic.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(pic.width * scale));
    canvas.height = Math.max(1, Math.round(pic.height * scale));
    canvas.getContext('2d')!.drawImage(pic.source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    pic.done();
  }
}

/**
 * Opens the camera (or, on a computer, the file picker) and resolves with the shrunk photo, or null if they backed out.
 * Rejects with a friendly message if the file isn't a picture we can read. The input is put on the page while the
 * picker is open: some desktop browsers and the desktop app drop the "picked a file" event for a detached input.
 */
export function pickPhoto(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; input.remove(); fn(); };
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return finish(() => resolve(null));
      shrinkPhoto(f).then((url) => finish(() => resolve(url)), (e: Error) => finish(() => reject(e)));
    });
    input.addEventListener('cancel', () => finish(() => resolve(null)));
    input.click();
  });
}

/** A chore's photo as a small thumbnail that opens big. */
export function PhotoThumb({ src, alt, size = 56 }: { src: string; alt: string; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="photo-thumb" style={{ width: size, height: size }} onClick={() => setOpen(true)} aria-label={`See the photo: ${alt}`}>
        <img src={src} alt={alt} loading="lazy" />
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} wide>
          <img src={src} alt={alt} style={{ width: '100%', borderRadius: 16, display: 'block' }} />
        </Modal>
      )}
    </>
  );
}

export const cheerOf = (id: string | null | undefined) => CHEERS.find((c) => c.id === id) ?? null;
