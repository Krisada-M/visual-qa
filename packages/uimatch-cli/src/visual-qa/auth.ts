import { chromium } from '@playwright/test';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { assertSameRoute } from '@uimatch/core';
import type { AuthenticationConfig } from './contract.js';

export interface PreparedAuth {
  statePath?: string;
  readySelector?: string;
  role?: string;
  cleanup: () => Promise<void>;
}

function enforceSameOrigin(runtimeUrl: string, loginUrl: string): void {
  if (new URL(runtimeUrl).origin !== new URL(loginUrl).origin) {
    throw new Error('Authentication login URL must use the same origin as the tested app');
  }
}

export async function prepareAuth(
  auth: AuthenticationConfig | undefined,
  runtimeUrl: string,
  baseDir: string
): Promise<PreparedAuth> {
  const none = async (): Promise<void> => {};
  if (!auth) return { cleanup: none };

  if (auth.kind === 'storage-state') {
    const path = isAbsolute(auth.path) ? auth.path : resolve(baseDir, auth.path);
    const file = await stat(path);
    if (!file.isFile()) throw new Error('Auth storageState must refer to a file');
    return { statePath: path, readySelector: auth.readySelector, role: auth.role, cleanup: none };
  }

  enforceSameOrigin(runtimeUrl, auth.loginUrl);
  const username = process.env[auth.usernameEnv];
  const password = process.env[auth.passwordEnv];
  if (!username || !password) {
    throw new Error('Missing QA login credentials in the configured environment variables');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'visual-qa-auth-'));
  const statePath = join(tempDir, 'state.json');
  const cleanup = async (): Promise<void> => {
    await rm(tempDir, { recursive: true, force: true });
  };

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(auth.loginUrl, { waitUntil: 'domcontentloaded' });
        await page.locator(auth.usernameSelector).fill(username);
        await page.locator(auth.passwordSelector).fill(password);
        await page.locator(auth.submitSelector).click();
        await page.goto(runtimeUrl, { waitUntil: 'domcontentloaded' });
        assertSameRoute(runtimeUrl, page.url());
        await page.locator(auth.readySelector).waitFor({ state: 'visible', timeout: 10_000 });
        await context.storageState({ path: statePath });
        await chmod(statePath, 0o600);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } catch {
    await cleanup();
    // Do not report URLs or credentials; a login may redirect with tokens.
    throw new Error('Unable to establish an authenticated QA session');
  }

  return { statePath, readySelector: auth.readySelector, role: auth.role, cleanup };
}
