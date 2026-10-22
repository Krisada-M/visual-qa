/**
 * Guard the rendered route before capture.
 * Query parameters are intentionally ignored: they may contain secrets.
 */
export function assertSameRoute(expectedUrl: string, actualUrl: string): void {
  const expected = new URL(expectedUrl);
  const actual = new URL(actualUrl);

  if (expected.origin !== actual.origin || expected.pathname !== actual.pathname) {
    // OAuth redirects can contain tokens. Never log the redirected URL.
    throw new Error('UIMATCH_AUTH_ROUTE_MISMATCH: browser left expected origin/path');
  }
}
