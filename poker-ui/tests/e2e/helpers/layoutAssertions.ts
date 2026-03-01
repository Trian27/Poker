import { expect, type Locator, type Page } from '@playwright/test';

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflowPx = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const maxWidth = Math.max(
      doc.scrollWidth,
      body?.scrollWidth ?? 0,
      doc.clientWidth
    );
    return maxWidth - window.innerWidth;
  });

  expect(overflowPx).toBeLessThanOrEqual(2);
}

export async function expectLocatorToBeInViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) {
    return;
  }

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}
