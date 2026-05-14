import { expect, test } from '@playwright/test';
import { installGameplayApiMocks, MockGameplaySocketServer } from './helpers/gameplayMocks';
import { seedAuthenticatedSession } from './helpers/session';

test.describe.configure({ mode: 'serial' });

test.describe('Gameplay smoke flow', () => {
  let socketServer: MockGameplaySocketServer;

  test.beforeEach(async ({ page }) => {
    socketServer = new MockGameplaySocketServer();
    await socketServer.start();
    await seedAuthenticatedSession(page);
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
  });

  test.afterEach(async () => {
    await socketServer.stop();
  });

  test('joins a table from the community lobby and surfaces action errors in-game', async ({ page }) => {
    await installGameplayApiMocks(page.context());
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Leagues' })).toBeVisible();
    await page.getByRole('button', { name: 'View Lobby' }).click();

    await expect(page).toHaveURL(/\/community\/1$/);
    await expect(page.getByRole('heading', { name: 'Alpha Community' })).toBeVisible();

    await page.getByRole('button', { name: 'Join Table' }).first().click();
    await expect(page.getByRole('heading', { name: 'Join Cash Table 1' })).toBeVisible();

    await page.getByTitle('Seat 1 - Available').click();
    await page.getByRole('button', { name: 'Join at Seat 1 with 200 chips' }).click();

    await expect(page).toHaveURL(/\/game\/11\?communityId=1$/);
    await expect(page.getByText('Poker Table')).toBeVisible();
    await expect(page.getByText('Street: flop')).toBeVisible();

    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Illegal action from gameplay smoke server')).toBeVisible();
    expect(socketServer.receivedActions.some((action) => action.action === 'check')).toBe(true);
  });

  test('auto-rejoins the active seat on reload', async ({ page }) => {
    const mockState = await installGameplayApiMocks(page.context(), {
      activeSeat: { active: true, table_id: 11, community_id: 1, seat_number: 1 },
      seats: [
        { id: 1101, seat_number: 1, user_id: 7, username: 'smoke-user', occupied_at: '2026-01-01T00:00:00Z' },
        { id: 1102, seat_number: 2, user_id: 8, username: 'villain', occupied_at: '2026-01-01T00:00:00Z' },
        { id: 1103, seat_number: 3, user_id: null, username: null, occupied_at: null },
        { id: 1104, seat_number: 4, user_id: null, username: null, occupied_at: null },
      ],
    });

    await page.context().addInitScript(() => {
      const originalGetEntriesByType = window.performance.getEntriesByType.bind(window.performance);
      Object.defineProperty(window.performance, 'getEntriesByType', {
        configurable: true,
        value: (type: string) => {
          if (type === 'navigation') {
            return [{ type: 'reload' }];
          }
          return originalGetEntriesByType(type);
        },
      });
    });

    await page.goto('/dashboard');
    await expect.poll(
      () => mockState.requestLog.filter((entry) => entry.method === 'GET' && entry.pathname === '/api/tables/me/active-seat').length
    ).toBeGreaterThan(0);

    await expect(page).toHaveURL(/\/game\/11\?communityId=1$/);
    await expect(page.getByText('Poker Table')).toBeVisible();
    await expect(page.getByText('Street: flop')).toBeVisible();
  });
});
