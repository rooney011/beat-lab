/** Make a small square cover thumbnail from embedded picture bytes. Main-thread, canvas 2D. */

const THUMB = 256;

export interface CoverBlobs {
  thumb: Blob;
  full: Blob;
}

export async function makeCover(bytes: Uint8Array, mime: string): Promise<CoverBlobs | null> {
  if (typeof createImageBitmap !== 'function' || bytes.length < 100) return null;
  const type = mime && mime.includes('/') ? mime : 'image/jpeg';
  const full = new Blob([bytes as BlobPart], { type });
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(full);
  } catch {
    return null;
  }
  try {
    const scale = Math.max(THUMB / bmp.width, THUMB / bmp.height);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = THUMB;
    canvas.height = THUMB;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, (THUMB - w) / 2, (THUMB - h) / 2, w, h);
    const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return thumb ? { thumb, full } : null;
  } catch {
    return null;
  } finally {
    bmp.close();
  }
}
