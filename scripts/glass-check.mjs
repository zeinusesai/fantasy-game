// Drill into the surfaces that measured opaque: what colour are they really?
import { chromium } from "playwright-core";

const BASE = process.env.PREVIEW_URL || "http://localhost:5176";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/auth?mode=signin`, { waitUntil: "networkidle" });
await page.waitForSelector("#username");
await page.fill("#username", process.env.AUDIT_USER || "zein");
await page.fill("#password", process.env.ZEIN_PASSWORD);
await page.waitForSelector('button[type="submit"]:not([disabled])');
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 45000 });

for (const route of ["/", "/dashboard"]) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const r = await page.evaluate(() => {
    const opaqueCards = [];
    for (const el of document.querySelectorAll('[data-slot="card"]')) {
      const cs = getComputedStyle(el);
      const a = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const alpha = a ? (a[1].split(/[,\s/]+/).filter(Boolean).length > 3 ? Number(a[1].split(/[,\s/]+/).filter(Boolean)[3]) : 1) : null;
      if (alpha === null || alpha >= 0.999) {
        opaqueCards.push({
          cls: el.className.slice(0, 70),
          bg: cs.backgroundColor,
          blur: cs.backdropFilter,
        });
      }
    }
    const h = document.querySelector("header");
    const hs = h ? getComputedStyle(h) : null;
    return {
      header: hs ? { bg: hs.backgroundColor, blur: hs.backdropFilter, cls: h.className.slice(0, 60) } : null,
      opaqueCards,
      body: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log(route, JSON.stringify(r, null, 1));
}
await browser.close();