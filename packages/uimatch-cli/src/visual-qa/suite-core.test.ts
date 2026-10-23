import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SuiteCaseSchema, preflight, suiteVerdict } from './suite-core.js';

let fixtureDir = '';

afterEach(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
  fixtureDir = '';
});

async function makeFixture() {
  fixtureDir = await mkdtemp(join(tmpdir(), 'vqa-suite-'));
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(390, 16);
  png.writeUInt32BE(844, 20);
  const digest = createHash('sha256').update(png).digest('hex');
  await writeFile(join(fixtureDir, 'figma.png'), png);
  await writeFile(
    join(fixtureDir, 'case.json'),
    JSON.stringify({
      id: 'suite-member',
      figma: { nodeId: '123:5', screenshot: './figma.png' },
      runtime: {
        url: 'http://127.0.0.1:3000/member',
        selector: '#app',
        viewport: { width: 390, height: 844 },
      },
      content: [{ policy: 'exact', selector: '#title', expected: 'Member' }],
      output: './artifacts',
    })
  );
  const item = SuiteCaseSchema.parse({
    name: 'Member default',
    manifest: './case.json',
    mapping: { confirmed: true, figmaNodeId: '123:5', runtimePath: '/member', state: 'default' },
    snapshot: {
      source: 'approved-fixture',
      exportedAt: '2026-10-22T10:00:00.000Z',
      sha256: digest,
      maxAgeHours: 72,
    },
  });
  return {
    item,
    now: Date.parse('2026-10-22T11:00:00.000Z'),
    path: join(fixtureDir, 'suite.json'),
  };
}

describe('Visual QA suite preflight', () => {
  it('accepts a confirmed mapping with matching versioned snapshot', async () => {
    const { item, now, path } = await makeFixture();
    expect((await preflight(path, item, now)).ok).toBe(true);
  });

  it('rejects inaccurate node mapping', async () => {
    const { item, now, path } = await makeFixture();
    const changed = { ...item, mapping: { ...item.mapping, figmaNodeId: 'other' } };
    expect((await preflight(path, changed, now)).reason).toBe('MAPPING_MISMATCH');
  });

  it('rejects modified image bytes and old screenshots', async () => {
    const { item, now, path } = await makeFixture();
    const changed = { ...item, snapshot: { ...item.snapshot, sha256: 'a'.repeat(64) } };
    expect((await preflight(path, changed, now)).reason).toBe('SNAPSHOT_CHANGED');
    const old = { ...item, snapshot: { ...item.snapshot, maxAgeHours: 0.5 } };
    expect((await preflight(path, old, now)).reason).toBe('SNAPSHOT_STALE');
  });

  it('rejects unconfirmed mappings at schema level', async () => {
    const { item } = await makeFixture();
    expect(() =>
      SuiteCaseSchema.parse({ ...item, mapping: { ...item.mapping, confirmed: false } })
    ).toThrow();
  });

  it('gives BLOCKED precedence over other verdicts', () => {
    expect(suiteVerdict(['VERIFIED', 'PARTIAL'])).toBe('PARTIAL');
    expect(suiteVerdict(['FAILED', 'BLOCKED'])).toBe('BLOCKED');
    expect(suiteVerdict(['VERIFIED'])).toBe('VERIFIED');
  });
});
