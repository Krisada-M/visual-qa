import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { ManifestSchema } from './contract.js';

const SHA256 = z.string().regex(/^[a-f0-9]{64}$/i);

export const SuiteCaseSchema = z.object({
  name: z.string().min(1),
  manifest: z.string().min(1),
  mapping: z.object({
    confirmed: z.literal(true),
    figmaNodeId: z.string().min(1),
    runtimePath: z.string().startsWith('/'),
    state: z.string().min(1),
  }),
  snapshot: z.object({
    source: z.enum(['figwright', 'figma-rest', 'approved-fixture']),
    exportedAt: z.string().datetime({ offset: true }),
    sha256: SHA256,
    maxAgeHours: z.number().positive().max(24 * 365).default(24 * 30),
  }),
});

export const SuiteSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  cases: z.array(SuiteCaseSchema).min(1).max(100),
});

export type SuiteCase = z.infer<typeof SuiteCaseSchema>;

export type CaseVerdict = 'VERIFIED' | 'FAILED' | 'PARTIAL' | 'BLOCKED';

export interface PreflightResult {
  ok: boolean;
  reason?: 'MAPPING_MISMATCH' | 'SNAPSHOT_MISSING' | 'SNAPSHOT_CHANGED' | 'SNAPSHOT_STALE' | 'SNAPSHOT_FUTURE';
  manifestPath: string;
  outputPath?: string;
}

function pngValid(buffer: Buffer): boolean {
  return (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.toString('ascii', 12, 16) === 'IHDR' &&
    buffer.readUInt32BE(16) > 0 &&
    buffer.readUInt32BE(20) > 0
  );
}

/** Reject unconfirmed mappings or screenshots that are missing, changed or stale. */
export async function preflight(
  suitePath: string,
  item: SuiteCase,
  now: number = Date.now()
): Promise<PreflightResult> {
  const manifestPath = resolve(dirname(suitePath), item.manifest);
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch {
    return { ok: false, reason: 'SNAPSHOT_MISSING', manifestPath };
  }

  // Invalid manifests must fail closed, not continue with partial configuration.
  const manifest = ManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!manifest.success) return { ok: false, reason: 'MAPPING_MISMATCH', manifestPath };

  const outputPath = resolve(dirname(manifestPath), manifest.data.output);
  const figmaPath = isAbsolute(manifest.data.figma.screenshot)
    ? manifest.data.figma.screenshot
    : resolve(dirname(manifestPath), manifest.data.figma.screenshot);
  const expectedUrl = new URL(manifest.data.runtime.url);
  if (
    manifest.data.figma.nodeId !== item.mapping.figmaNodeId ||
    expectedUrl.pathname !== item.mapping.runtimePath
  ) {
    return { ok: false, reason: 'MAPPING_MISMATCH', manifestPath, outputPath };
  }

  const exported = Date.parse(item.snapshot.exportedAt);
  if (!Number.isFinite(exported) || exported > now + 5 * 60_000) {
    return { ok: false, reason: 'SNAPSHOT_FUTURE', manifestPath, outputPath };
  }
  if (now - exported > item.snapshot.maxAgeHours * 3_600_000) {
    return { ok: false, reason: 'SNAPSHOT_STALE', manifestPath, outputPath };
  }

  let png: Buffer;
  try {
    png = await readFile(figmaPath);
  } catch {
    return { ok: false, reason: 'SNAPSHOT_MISSING', manifestPath, outputPath };
  }
  if (!pngValid(png)) {
    return { ok: false, reason: 'SNAPSHOT_CHANGED', manifestPath, outputPath };
  }
  const digest = createHash('sha256').update(png).digest('hex');
  if (digest.toLowerCase() !== item.snapshot.sha256.toLowerCase()) {
    return { ok: false, reason: 'SNAPSHOT_CHANGED', manifestPath, outputPath };
  }
  return { ok: true, manifestPath, outputPath };
}

export function suiteVerdict(cases: CaseVerdict[]): CaseVerdict {
  if (cases.includes('BLOCKED')) return 'BLOCKED';
  if (cases.includes('FAILED')) return 'FAILED';
  if (cases.includes('PARTIAL')) return 'PARTIAL';
  return 'VERIFIED';
}
