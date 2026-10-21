import { z } from 'zod';

const Selector = z.string().min(1);

export const ContentRuleSchema = z.discriminatedUnion('policy', [
  z.object({ policy: z.literal('exact'), selector: Selector, expected: z.string() }),
  z.object({
    policy: z.literal('dynamic'),
    selector: Selector,
    nonEmpty: z.boolean().default(true),
    noOverflow: z.boolean().default(true),
  }),
  z.object({ policy: z.literal('volatile'), selector: Selector }),
  z.object({ policy: z.literal('optional'), selector: Selector }),
]);

export const ManifestSchema = z.object({
  id: z.string().min(1),
  figma: z.object({
    nodeId: z.string().min(1),
    screenshot: z.string().min(1),
  }),
  runtime: z.object({
    url: z.string().url(),
    selector: Selector,
    viewport: z.object({
      width: z.number().int().positive().max(8192),
      height: z.number().int().positive().max(8192),
    }),
  }),
  content: z.array(ContentRuleSchema).default([]),
  output: z.string().min(1).default('artifacts/visual-qa'),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ContentRule = z.infer<typeof ContentRuleSchema>;
export type QaVerdict = 'VERIFIED' | 'FAILED' | 'PARTIAL' | 'BLOCKED';

export interface ContentObservation {
  matches: number;
  text: string;
  overflow: boolean;
}

export interface ContentFinding {
  selector: string;
  policy: ContentRule['policy'];
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  reason: string;
}

export function evaluateContent(
  rule: ContentRule,
  observation: ContentObservation
): ContentFinding {
  if (rule.policy === 'volatile' || rule.policy === 'optional') {
    return {
      selector: rule.selector,
      policy: rule.policy,
      status: 'SKIPPED',
      reason: 'Not a text gate',
    };
  }
  if (observation.matches !== 1) {
    return {
      selector: rule.selector,
      policy: rule.policy,
      status: 'FAIL',
      reason: 'Expected exactly one visible/attached element',
    };
  }
  if (rule.policy === 'exact') {
    const pass = observation.text === rule.expected;
    return {
      selector: rule.selector,
      policy: rule.policy,
      status: pass ? 'PASS' : 'FAIL',
      reason: pass ? 'Exact content matches' : 'Exact text mismatch',
    };
  }
  if (rule.nonEmpty && observation.text.trim().length === 0) {
    return {
      selector: rule.selector,
      policy: rule.policy,
      status: 'FAIL',
      reason: 'Dynamic text is empty',
    };
  }
  if (rule.noOverflow && observation.overflow) {
    return {
      selector: rule.selector,
      policy: rule.policy,
      status: 'FAIL',
      reason: 'Dynamic content overflows its box',
    };
  }
  return {
    selector: rule.selector,
    policy: rule.policy,
    status: 'PASS',
    reason: 'Dynamic content constraints satisfied',
  };
}

export function decideVerdict(
  visual: 'PASS' | 'FAIL' | 'BLOCKED',
  findings: ContentFinding[],
  hasVariableContent: boolean
): QaVerdict {
  if (findings.some((finding) => finding.status === 'FAIL')) return 'FAILED';
  if (visual === 'BLOCKED') return 'BLOCKED';
  // Pixel differences are not an acceptance gate when reference and runtime
  // intentionally carry different content. Require an aligned fixture or masks.
  if (hasVariableContent) return 'PARTIAL';
  return visual === 'PASS' ? 'VERIFIED' : 'FAILED';
}
