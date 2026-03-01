import { expect, test } from '@playwright/test';
import { installApiMocks } from './helpers/mockApi';
import { expectLocatorToBeInViewport, expectNoHorizontalOverflow } from './helpers/layoutAssertions';
import { seedAuthenticatedSession } from './helpers/session';

test.describe.configure({ mode: 'parallel' });

test.beforeEach(async ({ context }) => {
  await installApiMocks(context);
});

test('login page layout stays stable', async ({ page }) => {
  await page.goto('/login');

  const heading = page.getByRole('heading', { name: 'Login' });
  const submitButton = page.getByRole('button', { name: 'Login' });

  await expect(heading).toBeVisible();
  await expect(submitButton).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectLocatorToBeInViewport(page, submitButton);
});

test('register page layout stays stable', async ({ page }) => {
  await page.goto('/register');

  const heading = page.getByRole('heading', { name: 'Register' });
  const submitButton = page.getByRole('button', { name: 'Register' });

  await expect(heading).toBeVisible();
  await submitButton.scrollIntoViewIfNeeded();
  await expect(submitButton).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('dashboard layout stays stable for authenticated user', async ({ page }) => {
  await seedAuthenticatedSession(page);
  await page.goto('/dashboard');

  const leaguesHeading = page.getByRole('heading', { name: 'Leagues' });
  const createLeagueButton = page.getByRole('button', { name: '+ Create League' });
  const floatingRulesButton = page.locator('.rules-scroll-help.is-floating .rules-scroll-trigger');

  await expect(leaguesHeading).toBeVisible();
  await expect(createLeagueButton).toBeVisible();
  await expect(page.getByText('Alpha Community')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectLocatorToBeInViewport(page, createLeagueButton);

  await expect(floatingRulesButton).toBeVisible();
  await floatingRulesButton.click();
  await expect(page.getByRole('heading', { name: 'Poker Guide' })).toBeVisible();
});

test('community lobby layout stays stable for authenticated user', async ({ page }) => {
  await seedAuthenticatedSession(page);
  await page.goto('/community/1');

  const header = page.getByRole('heading', { name: 'Alpha Community' });
  const createTableButton = page.getByRole('button', { name: '+ Create Table' });
  const tableCard = page.locator('.table-card').first();

  await expect(header).toBeVisible();
  await expect(createTableButton).toBeVisible();
  await expect(page.getByText('Available Tables (2)')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await tableCard.scrollIntoViewIfNeeded();
  await expect(tableCard).toBeVisible();
});
