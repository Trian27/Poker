import type { Page } from '@playwright/test';

export const SMOKE_TEST_TOKEN = 'pw-smoke-token';

export const SMOKE_TEST_USER = {
  id: 7,
  username: 'smoke-user',
  email: 'smoke-user@example.com',
  created_at: '2026-01-01T00:00:00Z',
  is_admin: false,
  is_banned: false,
};

export async function seedAuthenticatedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ token, user }) => {
      window.localStorage.setItem('token', token);
      window.localStorage.setItem('user', JSON.stringify(user));
    },
    { token: SMOKE_TEST_TOKEN, user: SMOKE_TEST_USER }
  );
}
