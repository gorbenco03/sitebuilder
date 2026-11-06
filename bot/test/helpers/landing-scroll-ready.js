'use strict';

// CSS smooth scrolling advances by animation frames, not elapsed test-runner time.
async function prepareLandingScroll(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.scrollY > 200, null, { timeout: 3000 });
}

module.exports = { prepareLandingScroll };
