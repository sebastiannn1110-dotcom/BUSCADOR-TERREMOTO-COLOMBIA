import sharp from "sharp";

export const DEMO_PORTRAIT_MAX_BYTES = 8 * 1024 * 1024;

export async function createDemoPortraitJpeg(source) {
  const jpeg = await sharp(source, { failOn: "warning", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, progressive: true })
    .toBuffer();

  const hasJpegSignature = jpeg.length >= 4
    && jpeg[0] === 0xff
    && jpeg[1] === 0xd8
    && jpeg[jpeg.length - 2] === 0xff
    && jpeg[jpeg.length - 1] === 0xd9;
  if (!hasJpegSignature) throw new Error("El retrato de demostración no se pudo recodificar como JPEG.");
  if (jpeg.length > DEMO_PORTRAIT_MAX_BYTES) {
    throw new Error("El retrato JPEG de demostración supera el límite de 8 MB.");
  }

  return jpeg;
}
