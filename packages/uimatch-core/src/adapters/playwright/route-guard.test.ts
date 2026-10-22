import { describe, expect, it } from 'vitest';
import { assertSameRoute } from './route-guard';

describe('authenticated route guard', () => {
  it('accepts the expected origin and path even if query varies', () => {
    expect(() =>
      assertSameRoute(
        'https://app.example.test/member',
        'https://app.example.test/member?tab=wallet'
      )
    ).not.toThrow();
  });

  it('rejects login and cross-origin redirects without revealing sensitive URLs', () => {
    expect(() =>
      assertSameRoute(
        'https://app.example.test/member',
        'https://app.example.test/login?token=secret'
      )
    ).toThrow('UIMATCH_AUTH_ROUTE_MISMATCH');
    expect(() =>
      assertSameRoute('https://app.example.test/member', 'https://other.test/member')
    ).toThrow('UIMATCH_AUTH_ROUTE_MISMATCH');
  });
});
