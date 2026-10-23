import { readFileSync, statSync } from 'node:fs';

const MAX_PNG_BYTES = 32 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Accept screenshots exported by Figwright as local PNGs, without requiring
 * a large base64 value in an environment variable (which can exceed OS limits).
 */
export function hasFigmaPngBypass(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.UIMATCH_FIGMA_PNG_B64?.trim() || env.UIMATCH_FIGMA_PNG_PATH?.trim());
}

export function readFigmaPngBypass(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const inline = env.UIMATCH_FIGMA_PNG_B64?.trim();
  if (inline) return inline;

  const path = env.UIMATCH_FIGMA_PNG_PATH?.trim();
  if (!path) return undefined;

  const stats = statSync(path);
  if (!stats.isFile() || stats.size > MAX_PNG_BYTES) {
    throw new Error('Figma PNG must be a regular file no larger than 32 MiB');
  }

  const png = readFileSync(path);
  if (
    png.length < 24 ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    png.toString('ascii', 12, 16) !== 'IHDR' ||
    png.readUInt32BE(16) === 0 ||
    png.readUInt32BE(20) === 0
  ) {
    throw new Error('Figma screenshot must be a valid PNG with nonzero dimensions');
  }

  return png.toString('base64');
}
