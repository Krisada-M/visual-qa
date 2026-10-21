import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasFigmaPngBypass, readFigmaPngBypass } from './figma-png-bypass.js';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'uimatch-figwright-'));
  created.push(dir);
  const path = join(dir, 'design.png');
  writeFileSync(path, bytes);
  return path;
}

function pngHeader(): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(390, 16);
  bytes.writeUInt32BE(844, 20);
  return bytes;
}

describe('Figwright PNG file bypass', () => {
  it('loads the exported PNG without requiring a Figma token', () => {
    const bytes = pngHeader();
    const path = fixture(bytes);
    expect(hasFigmaPngBypass({ UIMATCH_FIGMA_PNG_PATH: path })).toBe(true);
    expect(readFigmaPngBypass({ UIMATCH_FIGMA_PNG_PATH: path })).toBe(bytes.toString('base64'));
  });

  it('retains the legacy inline base64 path', () => {
    const env = { UIMATCH_FIGMA_PNG_B64: 'dGVzdA==', UIMATCH_FIGMA_PNG_PATH: '/absent.png' };
    expect(readFigmaPngBypass(env)).toBe('dGVzdA==');
  });

  it('rejects non-PNG files before comparison', () => {
    const path = fixture(Buffer.from('not a png'));
    expect(() => readFigmaPngBypass({ UIMATCH_FIGMA_PNG_PATH: path })).toThrow('valid PNG');
  });

  it('returns undefined when no bypass is configured', () => {
    expect(hasFigmaPngBypass({})).toBe(false);
    expect(readFigmaPngBypass({})).toBeUndefined();
  });
});
