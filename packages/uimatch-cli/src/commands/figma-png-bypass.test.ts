import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
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

function validPng(): Buffer {
  const image = new PNG({ width: 2, height: 3 });
  image.data.fill(255);
  return PNG.sync.write(image);
}

describe('Figwright PNG bypass', () => {
  it('loads the local exported PNG without a Figma token', () => {
    const bytes = validPng();
    expect(readFigmaPngBypass({ UIMATCH_FIGMA_PNG_PATH: fixture(bytes) })).toBe(
      bytes.toString('base64')
    );
  });

  it('accepts inline base64 and standard data URLs', () => {
    const bytes = validPng();
    const b64 = bytes.toString('base64');
    expect(readFigmaPngBypass({ UIMATCH_FIGMA_PNG_B64: b64 })).toBe(b64);
    expect(readFigmaPngBypass({ UIMATCH_FIGMA_PNG_B64: `data:image/png;base64,${b64}` })).toBe(b64);
  });

  it('keeps inline input precedence but rejects a forged payload', () => {
    const env = {
      UIMATCH_FIGMA_PNG_B64: Buffer.from('not a png').toString('base64'),
      UIMATCH_FIGMA_PNG_PATH: fixture(validPng()),
    };
    expect(hasFigmaPngBypass(env)).toBe(true);
    expect(() => readFigmaPngBypass(env)).toThrow('valid PNG');
  });

  it('rejects malformed and noncanonical base64 before decode', () => {
    expect(() => readFigmaPngBypass({ UIMATCH_FIGMA_PNG_B64: '!@#?' })).toThrow('malformed');
    expect(() => readFigmaPngBypass({ UIMATCH_FIGMA_PNG_B64: 'AAAA====' })).toThrow('malformed');
  });

  it('rejects oversized inline input before allocating a buffer', () => {
    expect(() => readFigmaPngBypass({ UIMATCH_FIGMA_PNG_B64: 'A'.repeat(45_000_000) })).toThrow(
      '32 MiB'
    );
  });

  it('rejects non-PNG files and excessive PNG dimensions', () => {
    expect(() =>
      readFigmaPngBypass({ UIMATCH_FIGMA_PNG_PATH: fixture(Buffer.from('not png')) })
    ).toThrow('valid PNG');
    const header = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'ascii');
    header.writeUInt32BE(16_385, 16);
    header.writeUInt32BE(1, 20);
    expect(() => readFigmaPngBypass({ UIMATCH_FIGMA_PNG_PATH: fixture(header) })).toThrow(
      'dimensions'
    );
  });

  it('does nothing when no source is provided', () => {
    expect(hasFigmaPngBypass({})).toBe(false);
    expect(readFigmaPngBypass({})).toBeUndefined();
  });
});
