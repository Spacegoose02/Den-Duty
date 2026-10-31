// Photo proof: kids snap a picture of a finished chore; it's shrunk on the device before it's sent.
import { useState } from 'react';
import { CHEERS } from '../../../shared/catalog.ts';
import { Modal } from './Bits.tsx';

const MAX_SIDE = 1024;

/** Shrinks a picked photo to at most 1024px on its long side, as a JPEG data: URL. */
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** Opens the camera (or photo picker) and resolves with the shrunk photo, or null if they backed out. */
export function pickPhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      shrinkPhoto(f).then(resolve, () => resolve(null));
    };
    input.addEventListener('cancel', () => resolve(null));
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
