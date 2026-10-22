import { z } from 'zod';

const NamedState = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.string().min(1),
});

export const MappingIndexSchema = z.object({
  frames: z.array(NamedState).min(1).max(500),
  screens: z
    .array(NamedState.extend({ path: z.string().startsWith('/') }))
    .min(1)
    .max(500),
});

export type MappingIndex = z.infer<typeof MappingIndexSchema>;

export interface MappingCandidate {
  figmaNodeId: string;
  screenId: string;
  runtimePath: string;
  state: string;
  heuristicScore: number;
  confirmed: false;
}

function words(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1 && !['page', 'screen', 'frame'].includes(word))
  );
}

function similarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Hints only. Never writes manifests or automatically confirms a route/frame.
 * Screens with unmatched states should remain unconfirmed until reviewed.
 */
export function suggestMappings(index: MappingIndex): MappingCandidate[] {
  const candidates: MappingCandidate[] = [];
  for (const frame of index.frames) {
    const matches = index.screens.map((screen) => {
      const nameScore = Math.max(
        similarity(frame.name, screen.name),
        similarity(frame.name, screen.path)
      );
      const stateScore = frame.state === screen.state ? 1 : 0;
      const heuristicScore = Math.round((nameScore * 0.8 + stateScore * 0.2) * 100) / 100;
      return {
        figmaNodeId: frame.id,
        screenId: screen.id,
        runtimePath: screen.path,
        state: screen.state,
        heuristicScore,
        confirmed: false as const,
      };
    });
    candidates.push(
      ...matches
        .filter((candidate) => candidate.heuristicScore > 0)
        .sort((a, b) => b.heuristicScore - a.heuristicScore)
        .slice(0, 3)
    );
  }
  return candidates;
}
