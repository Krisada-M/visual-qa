import { describe, expect, it } from 'vitest';
import { ContentRuleSchema, decideVerdict, evaluateContent } from './contract.js';

describe('visual QA content policies', () => {
  it('rejects incorrect fixed copy', () => {
    const rule = ContentRuleSchema.parse({
      policy: 'exact',
      selector: '#cta',
      expected: 'Pay Now',
    });
    expect(evaluateContent(rule, { matches: 1, text: 'Submit', overflow: false }).status).toBe(
      'FAIL'
    );
  });

  it('allows changed dynamic text without ignoring overflow', () => {
    const rule = ContentRuleSchema.parse({ policy: 'dynamic', selector: '#member' });
    expect(
      evaluateContent(rule, { matches: 1, text: 'Another member', overflow: false }).status
    ).toBe('PASS');
    expect(
      evaluateContent(rule, { matches: 1, text: 'Longer member name', overflow: true }).status
    ).toBe('FAIL');
  });

  it('does not treat intentionally variable screenshots as verified parity', () => {
    expect(decideVerdict('PASS', [], true)).toBe('PARTIAL');
    expect(decideVerdict('FAIL', [], true)).toBe('PARTIAL');
  });

  it('does not conceal a failed content assertion', () => {
    const rule = ContentRuleSchema.parse({ policy: 'dynamic', selector: '#member' });
    const failure = evaluateContent(rule, { matches: 0, text: '', overflow: false });
    expect(decideVerdict('PASS', [failure], true)).toBe('FAILED');
  });

  it('requires visual success when content is stable', () => {
    expect(decideVerdict('FAIL', [], false)).toBe('FAILED');
    expect(decideVerdict('PASS', [], false)).toBe('VERIFIED');
    expect(decideVerdict('BLOCKED', [], false)).toBe('BLOCKED');
  });
});
