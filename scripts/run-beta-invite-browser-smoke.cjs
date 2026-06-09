const { chromium } = require('../poker-ui/node_modules/playwright');

const [uiBaseUrl, inviteUrl, inviteEmail, inviteUsername, invitePassword] = process.argv.slice(2);

if (!uiBaseUrl || !inviteUrl || !inviteEmail || !inviteUsername || !invitePassword) {
  console.error('Usage: node scripts/run-beta-invite-browser-smoke.cjs <uiBaseUrl> <inviteUrl> <inviteEmail> <inviteUsername> <invitePassword>');
  process.exit(1);
}

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${uiBaseUrl}/register`, { waitUntil: 'networkidle' });
    const registerHeading = await page.locator('h2').textContent();
    if (registerHeading !== 'Invite Required') {
      throw new Error(`Expected invite-only register screen, got heading: ${registerHeading}`);
    }

    await page.goto(inviteUrl, { waitUntil: 'networkidle' });

    const displayedEmail = (await page.locator('.auth-static-value').textContent())?.trim();
    if (displayedEmail !== inviteEmail) {
      throw new Error(`Expected invite email ${inviteEmail}, got ${displayedEmail}`);
    }

    await page.getByLabel('Username').fill(inviteUsername);
    await page.getByLabel('Password', { exact: true }).fill(invitePassword);
    await page.getByLabel('Confirm Password').fill(invitePassword);
    await page.getByRole('button', { name: 'Create Account' }).click();

    await page.waitForURL(/\/(dashboard|tutorial)$/);

    const currentUrl = page.url();
    const storedToken = await page.evaluate(() => window.localStorage.getItem('token'));
    if (!storedToken) {
      throw new Error('Expected auth token in localStorage after invite acceptance');
    }

    console.log(JSON.stringify({
      register_heading: registerHeading,
      displayed_email: displayedEmail,
      final_url: currentUrl,
      token_present: true,
    }));
  } finally {
    await browser.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
