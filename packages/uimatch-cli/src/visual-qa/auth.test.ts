import { describe, expect, it } from 'vitest';
import { prepareAuth } from './auth.js';
import { AuthenticationSchema } from './contract.js';

describe('P1 authentication contract', () => {
  it('rejects environment variable values and accepts names only', () => {
    expect(() =>
      AuthenticationSchema.parse({
        kind: 'ui-login',
        role: 'member',
        loginUrl: 'http://127.0.0.1/login',
        usernameSelector: '#user',
        passwordSelector: '#pass',
        submitSelector: '#login',
        usernameEnv: 'actual-user@example.test',
        passwordEnv: 'QA_PASSWORD',
        readySelector: '#member',
      })
    ).toThrow();
  });

  it('rejects cross-origin login without ever requesting credentials', async () => {
    const auth = AuthenticationSchema.parse({
      kind: 'ui-login',
      role: 'staff',
      loginUrl: 'https://other.example.test/login',
      usernameSelector: '#user',
      passwordSelector: '#pass',
      submitSelector: '#login',
      usernameEnv: 'QA_STAFF_USER',
      passwordEnv: 'QA_STAFF_PASSWORD',
      readySelector: '#staff-root',
    });
    await expect(prepareAuth(auth, 'https://app.example.test/staff', '.')).rejects.toThrow(
      'same origin'
    );
  });
});
