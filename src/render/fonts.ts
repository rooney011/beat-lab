/** Font stacks used on canvas. The faces are self-hosted (see src/styles/fonts.css). */
export const FONT_DISPLAY = '"Dela Gothic One", Impact, sans-serif';
export const FONT_UI = '"Archivo Variable", Archivo, "Helvetica Neue", Arial, sans-serif';
export const FONT_MONO = '"Space Mono", ui-monospace, monospace';

/** Wait for the faces the canvas draws with, so the first frames don't fall back to Impact. */
export async function loadCanvasFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  await Promise.allSettled([
    document.fonts.load('40px "Dela Gothic One"'),
    document.fonts.load('800 20px "Archivo Variable"'),
    document.fonts.load('bold 15px "Space Mono"'),
  ]);
}
