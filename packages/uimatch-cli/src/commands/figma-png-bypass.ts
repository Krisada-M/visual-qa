import { readFileSync, statSync } from 'node:fs';

const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_PNG_DIMENSION = 16_384;
const MAX_PNG_PIXELS = 25_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_BASE64_CHARS = Math.ceil(MAX_PNG_BYTES / 3) * 4;

function encodeValidatedPng(png: Buffer): string {
  if (
    png.length < 24 ||
    png.length > MAX_PNG_BYTES ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Figma screenshot must have a valid PNG header within the 32 MiB limit');
  }

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (
    width === 0 ||
    height === 0 ||
    width > MAX_PNG_DIMENSION ||
    height > MAX_PNG_DIMENSION ||
    width * height > MAX_PNG_PIXELS
  ) {
    throw new Error('Figma PNG dimensions exceed the allowed image limits');
  }

  // Deliberately a fast preflight, not a complete PNG decode or CRC validator.
  // The downstream image decoder must still reject truncated/corrupted PNGs.
  return png.toString('base64');
}

/**
 * Accept local Figwright-exported PNGs without requiring a large base64 value
 * in an environment variable. Both input methods share the same size and
 * image-dimension limits; neither is an authorization bypass.
 */
export function hasFigmaPngBypass(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.UIMATCH_FIGMA_PNG_B64?.trim() || env.UIMATCH_FIGMA_PNG_PATH?.trim());
}

export function readFigmaPngBypass(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const inline = env.UIMATCH_FIGMA_PNG_B64?.trim();
  if (inline) {
    const normalized = inline.replace(/^data:image\/png;base64,/, '').replace(/\s+/g, '');
    if (
      normalized.length > MAX_BASE64_CHARS ||
      normalized.length === 0 ||
      normalized.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    ) {
      throw new Error('Figma base64 PNG is malformed or exceeds the 32 MiB limit');
    }
    const png = Buffer.from(normalized, 'base64');
    if (png.toString('base64') !== normalized) {
      throw new Error('Figma base64 PNG must use canonical encoding');
    }
    return encodeValidatedPng(png);
  }

  const path = env.UIMATCH_FIGMA_PNG_PATH?.trim();
  if (!path) return undefined;

  const stats = statSync(path);
  if (!stats.isFile() || stats.size > MAX_PNG_BYTES) {
    throw new Error('Figma PNG must be a regular file no larger than 32 MiB');
  }
  return encodeValidatedPng(readFileSync(path));
}
