import { readFile } from 'node:fs/promises';
import { MappingIndexSchema, suggestMappings } from './mapping.js';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error('Expected a mapping-index JSON path');
  const index = MappingIndexSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
  const candidates = suggestMappings(index);
  process.stdout.write(JSON.stringify({ candidates, note: 'Suggestions only. Manually confirm mappings before running a suite.' }, null, 2) + '\n');
}

main().catch(() => {
  process.stderr.write('Mapping suggestions BLOCKED: missing or invalid index\n');
  process.exitCode = 2;
});
