// Browser inspection harness for the Liquid Glass UI.
//
// Drives the Freebuff preview in headless Chromium and measures the things
// that are hard to eyeball from source: horizontal spill / clipping, text
// that gets cut off, computed contrast of text against its real (alpha
// composited) backdrop, and whether an open popover/dialog actually paints
// above the glass surfaces behind it.
//
// Usage:  node scripts/ui-audit.mjs [--user=zein] [--password-env=ZEIN_PASSWORD]
// Output: /tmp/ui-audit/<slug>-<width>.png  +  a JSON report on stdout.

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.PREVIEW_URL || "http://localhost:5176";
const OUT = "/tmp/ui-audit";
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);
const USERNAME = argv.user || "zein";
const PASSWORD = process.env[argv["password-env"] || "ZEIN_PASSWORD"];

const ALL_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const VIEWPORTS = argv.viewport ? ALL_VIEWPORTS.filter((v) => v.name === argv.viewport) : ALL_VIEWPORTS;

const ROUTES = (argv.routes ? argv.routes.split(",") : [
  "/",
  "/auth",
  "/dashboard",
  "/leaderboard",
  "/profile",
  "/squad",
  "/admin",
]);

// Overlays/tabs that must layer above the translucent surfaces.
const INTERACTIONS = {
  "/leaderboard": [
    {
      name: "sections-tab",
      expectOverlay: false,
      open: async (page) => {
        await page.getByRole("tab", { name: /sections/i }).click({ timeout: 15000 });
      },
    },
  ],
  "/profile": [
    {
      name: "section-popover",
      open: async (page) => {
        await page.locator("#profile-section").click({ timeout: 15000 });
      },
    },
    {
      name: "favourite-popover",
      open: async (page) => {
        await page
          .locator('[role="combobox"]:not(#profile-section):not(#supported-house)')
          .first()
          .click({ timeout: 15000 });
      },
    },
  ],
  "/squad": [
    {
      name: "player-dialog",
      open: async (page) => {
        await page.locator('button[title="Player details"]').first().click({ timeout: 15000 });
      },
    },
  ],
  // Every Admin tab is a separate layout; sweep them all.
  "/admin": Array.from({ length: 8 }, (_, i) => ({
    name: `tab-${i}`,
    expectOverlay: false,
    open: async (page) => {
      await page.locator('[role="tab"]').nth(i).click({ timeout: 15000 });
    },
  })),
};

// ── in-page audit ───────────────────────────────────────────────────────────
function auditScript() {
  const srgb = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = ([r, g, b]) =>
    0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (str) => {
    const s = String(str).trim();
    const nums = (body) => body.split(/[,\s/]+/).filter(Boolean).map(Number);
    // legacy rgba() / rgb()
    let m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = nums(m[1]);
      return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
    }
    // oklab(L a b / alpha)
    m = s.match(/^oklab\(([^)]+)\)$/);
    if (m) {
      const p = nums(m[1]);
      const [L, A, B] = p;
      const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
      const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
      const s_ = L - 0.0894841775 * A - 1.291485548 * B;
      const l = l_ ** 3;
      const mm = m_ ** 3;
      const ss = s_ ** 3;
      const lin = [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss,
        -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * ss,
      ];
      const enc = lin.map((v) => {
        const c = Math.max(0, Math.min(1, v));
        return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
      });
      return { rgb: enc, a: p.length > 3 ? p[3] : 1 };
    }
    // oklch(L C H / alpha)
    m = s.match(/^oklch\(([^)]+)\)$/);
    if (m) {
      const p = nums(m[1]);
      const [L, C, H] = p;
      const rad = (H * Math.PI) / 180;
      return parse(`oklab(${L} ${C * Math.cos(rad)} ${C * Math.sin(rad)}${p.length > 3 ? ` / ${p[3]}` : ""})`);
    }
    // color(srgb r g b / alpha)
    m = s.match(/^color\(srgb ([^)]+)\)$/);
    if (m) {
      const p = nums(m[1]);
      return { rgb: [p[0] * 255, p[1] * 255, p[2] * 255], a: p.length > 3 ? p[3] : 1 };
    }
    if (s === "transparent") return { rgb: [0, 0, 0], a: 0 };
    return null;
  };
  const over = (fg, bg) => [
    fg.rgb[0] * fg.a + bg[0] * (1 - fg.a),
    fg.rgb[1] * fg.a + bg[1] * (1 - fg.a),
    fg.rgb[2] * fg.a + bg[2] * (1 - fg.a),
  ];
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  /**
   * Composite every ancestor background down onto the html base.
   * A gradient background cannot be reduced to one colour, so instead of
   * silently comparing the text against whatever solid colour sits *behind*
   * it (which reports bogus failures for badges like the captain "C"), return
   * one candidate background per gradient colour stop. The worst candidate
   * is the honest measurement.
   */
  function effectiveBgs(el) {
    const stack = [];
    let gradient = null; // { stops: [parsed], at: index into stack }
    let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      const img = cs.backgroundImage;
      if (!gradient && img && img !== "none" && img.indexOf("gradient") !== -1) {
        const stops = [];
        // Tailwind v4 gradient stops are oklch()/oklab(), so pull out every
        // colour function (not just rgb) and skip the gradient/direction
        // wrapper itself, which parse() cannot read.
        for (const m of img.matchAll(
          /(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^()]*(?:\([^()]*\)[^()]*)*\)/g,
        )) {
          const c = parse(m[0].trim());
          if (c && c.a > 0) stops.push(c);
        }
        if (stops.length) gradient = { stops, at: stack.length };
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a >= 0.999) break;
      n = n.parentElement;
    }
    // Flatten a contiguous run of solid layers into one colour over `under`.
    const flatten = (from, to, under) => {
      let base = under;
      for (let i = to - 1; i >= from; i--) base = over(stack[i], base);
      return base;
    };
    if (!gradient) return [flatten(0, stack.length, [255, 255, 255])];
    // Ancestors below the gradient element, then the gradient stops, then the
    // element's own solid backgrounds painted over the gradient.
    const under = flatten(gradient.at, stack.length, [255, 255, 255]);
    const above = gradient.at;
    return gradient.stops.map((stop) => flatten(0, above, over(stop, under)));
  }

  const label = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls =
      typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
    const txt = (el.textContent || "").trim().slice(0, 28);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ""}`;
  };

  const scrollParent = (el) => {
    let n = el.parentElement;
    while (n) {
      const o = getComputedStyle(n).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden") return n;
      n = n.parentElement;
    }
    return null;
  };

  const out = { contrast: [], spill: [], clipping: [], glass: [], unparsed: [], overflow: null, layers: null };

  // 1. page-level horizontal overflow
  const de = document.scrollingElement;
  out.overflow = {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    overflowing: de.scrollWidth > de.clientWidth + 1,
  };

  const all = Array.from(document.querySelectorAll("body *"));

  // 2. contrast of every visible text node's element
  const seen = new Set();
  for (const el of all) {
    const hasText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg) {
      const k = cs.color;
      if (!seen.has(k)) {
        seen.add(k);
        out.unparsed.push({ el: label(el), color: k, sample: el.textContent.trim().slice(0, 30) });
      }
      continue;
    }
    const bgs = effectiveBgs(el);
    // Worst candidate wins: the text must clear AA against every colour it can
    // actually sit on.
    let cr = Infinity;
    let worst = null;
    for (const bg of bgs) {
      const eff = fg.a < 1 ? over(fg, bg) : fg.rgb;
      const r = ratio(eff, bg);
      if (r < cr) {
        cr = r;
        worst = bg;
      }
    }
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      const key = cs.color + "|" + Math.round(cr * 10);
      if (seen.has(key)) continue;
      seen.add(key);
      out.contrast.push({
        el: label(el),
        ratio: Math.round(cr * 100) / 100,
        need,
        color: cs.color,
        size,
        weight,
        bg: `rgb(${worst.map((v) => Math.round(v)).join(",")})`,
        sample: el.textContent.trim().slice(0, 40),
      });
    }
  }

  // 3. elements protruding past the viewport, ignoring intentional scrollers
  const vw = document.documentElement.clientWidth;
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    if (scrollParent(el)) continue;
    out.spill.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right), vw });
  }

  // 4. content cut off by an overflow:hidden box. An element only counts as a
  //    defect when no ancestor can scroll it into view (an overflow-x:auto
  //    ancestor makes a wide child intentional, not clipped).
  const reachable = (el) => {
    let n = el.parentElement;
    while (n) {
      const o = getComputedStyle(n).overflowX;
      if ((o === "auto" || o === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
      n = n.parentElement;
    }
    return false;
  };
  for (const el of all) {
    if (!el.textContent || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.overflowX !== "hidden") continue;
    if (cs.textOverflow === "ellipsis") continue;
    if (el.scrollWidth <= el.clientWidth + 2 || el.clientWidth <= 8) continue;
    if (reachable(el)) continue;
    // only report the outermost box, not every nested descendant
    if (el.parentElement && all.some((p) => p.contains(el) && getComputedStyle(p).overflowX === "hidden" && p.scrollWidth > p.clientWidth + 2))
      continue;
    out.clipping.push({
      el: label(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      sample: el.textContent.trim().slice(0, 40),
    });
  }

  // 4b. nodes that sit past the viewport edge with no way to reach them
  const vw0 = document.documentElement.clientWidth;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= vw0 + 1 && r.left >= -1) continue;
    if (reachable(el)) continue;
    const childOut = Array.from(el.children).some((c) => {
      const cr = c.getBoundingClientRect();
      return cr.right > vw0 + 1 || cr.left < -1;
    });
    if (childOut) continue;
    out.spill.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right), vw: vw0 });
  }

  // 5. do the glass utilities actually resolve to real translucency?
  const glassy = Array.from(
    document.querySelectorAll('[class*="glass"], header, [role="dialog"], [data-radix-popper-content-wrapper] > *'),
  );
  for (const el of glassy.slice(0, 400)) {
    const cs = getComputedStyle(el);
    const bg = parse(cs.backgroundColor);
    const bd = parse(cs.borderTopColor);
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (bg && bg.a >= 0.999 && !cs.backdropFilter.includes("blur") && cs.borderTopWidth === "0px")
      continue;
    out.glass.push({
      el: label(el),
      bg: cs.backgroundColor,
      alpha: bg ? bg.a : null,
      blur: cs.backdropFilter,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${bd ? `rgba(${bd.rgb.join(",")},${bd.a})` : cs.borderTopColor}`,
    });
  }
  out.crashed =
    /process is not defined|Root crash|Preview runtime error/i.test(document.body.innerText) ||
    null;
  out.glassStats = {
    total: out.glass.length,
    translucent: out.glass.filter((g) => g.alpha !== null && g.alpha < 0.999).length,
    blurred: out.glass.filter((g) => g.blur && g.blur !== "none").length,
  };

  // 6. stacking: does the topmost painted node at the overlay's centre belong
  //    to the overlay (i.e. is it really on top of the glass behind it)?
  const overlay =
    document.querySelector("[role='dialog']") ||
    document.querySelector("[data-radix-popper-content-wrapper]") ||
    document.querySelector("[data-state='open'].glass");
  if (overlay) {
    const r = overlay.getBoundingClientRect();
    const pts = [
      [r.left + r.width / 2, r.top + Math.min(24, r.height / 2)],
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 8, r.top + 8],
    ].filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < innerHeight);
    const hits = pts.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return {
        x: Math.round(x),
        y: Math.round(y),
        top: hit ? label(hit) : null,
        insideOverlay: hit ? overlay.contains(hit) || hit === overlay : false,
      };
    });
    const cs = getComputedStyle(overlay);
    out.layers = {
      overlay: label(overlay),
      zIndex: cs.zIndex,
      position: cs.position,
      blur: cs.backdropFilter,
      bg: cs.backgroundColor,
      hits,
      allOnTop: hits.every((h) => h.insideOverlay),
    };
  }
  return out;
}

// ── driver ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
const report = { base: BASE, routes: [] };
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const context = await browser.newContext({ deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${page.url()} :: ${String(e).slice(0, 200)}`));

// sign in once, reusing the storage state for every viewport
let signedIn = false;
async function ensureAuth() {
  if (signedIn) return;
  if (!PASSWORD) throw new Error("set ZEIN_PASSWORD for the sign-in sweep");
  // The auth page defaults to signup mode; sign-in is opt-in via ?mode=signin.
  await page.goto(`${BASE}/auth?mode=signin`, { waitUntil: "networkidle" });
  await page.waitForSelector("#username", { timeout: 20000 });
  await page.fill("#username", USERNAME);
  await page.fill("#password", PASSWORD);
  await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 20000 });
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 45000 });
  await page.waitForTimeout(2500);
  signedIn = true;
}

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await ensureAuth();
  for (const route of ROUTES) {
    const slug = route === "/" ? "landing" : route.replace(/\//g, "-").replace(/^-/, "");
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1800);
      const res = await page.evaluate(auditScript);
      await page.screenshot({ path: `${OUT}/${slug}-${vp.name}.png`, fullPage: true, animations: "disabled", timeout: 60000 });
      report.routes.push({ route, viewport: vp.name, ...res });

      // ── interaction pass: open the overlays and tabs the glass theme has to
      //    keep on top, then re-audit with the overlay open.
      for (const step of INTERACTIONS[route] ?? []) {
        try {
          await step.open(page);
          await page.waitForTimeout(1200);
          const open = await page.evaluate(auditScript);
          await page.screenshot({ path: `${OUT}/${slug}-${vp.name}-${step.name}.png`, animations: "disabled", timeout: 60000 });
          report.routes.push({ route: `${route} :: ${step.name}`, viewport: vp.name, expectOverlay: step.expectOverlay !== false, ...open });
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
        } catch (e) {
          report.routes.push({
            route: `${route} :: ${step.name}`,
            viewport: vp.name,
            error: String(e).slice(0, 300),
          });
        }
      }
    } catch (e) {
      report.routes.push({ route, viewport: vp.name, error: String(e).slice(0, 300) });
    }
  }
}

report.consoleErrors = [...new Set(consoleErrors)];
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();

// ── human summary ───────────────────────────────────────────────────────────
let bad = 0;
for (const r of report.routes) {
  if (r.error) {
    console.log(`✗ ${r.route} [${r.viewport}] ERROR ${r.error}`);
    bad++;
    continue;
  }
  const issues = [];
  if (r.crashed) issues.push(`CRASH: ${r.crashed}`);
  if (r.overflow?.overflowing) issues.push(`PAGE H-SCROLL ${r.overflow.scrollWidth}>${r.overflow.clientWidth}`);
  if (r.contrast.length) issues.push(`low-contrast x${r.contrast.length}`);
  if (r.spill.length) issues.push(`viewport-spill x${r.spill.length}`);
  if (r.clipping.length) issues.push(`clipped-text x${r.clipping.length}`);
  if (r.layers && !r.layers.allOnTop) issues.push("OVERLAY-NOT-ON-TOP");
  if (issues.length) bad++;
  console.log(`${issues.length ? "✗" : "✓"} ${r.route} [${r.viewport}] ${issues.join(" | ") || "clean"}`);
}
console.log("\n=== detail ===");
for (const r of report.routes) {
  if (r.error) continue;
  const lines = [];
  if (r.crashed) lines.push(`  CRASH: ${r.crashed}`);
  if (r.overflow?.overflowing) lines.push(`  page h-scroll ${r.overflow.scrollWidth} > ${r.overflow.clientWidth}`);
  for (const c of r.contrast) lines.push(`  contrast ${c.ratio}<${c.need} ${c.el} [${c.color} on ${c.bg} ${c.size}px/${c.weight}] "${c.sample}"`);
  for (const s of r.spill.slice(0, 8)) lines.push(`  spill ${s.el} right=${s.right} vw=${s.vw}`);
  for (const c of r.clipping.slice(0, 8)) lines.push(`  clip ${c.el} ${c.scrollWidth}>${c.clientWidth} "${c.sample}"`);
  if (r.layers)
    lines.push(
      `  overlay ${r.layers.overlay} z=${r.layers.zIndex} pos=${r.layers.position} blur=${r.layers.blur} onTop=${r.layers.allOnTop}${
        r.layers.allOnTop ? "" : ` misses=${JSON.stringify(r.layers.hits.filter((h) => !h.insideOverlay))}`
      }`,
    );
  if (!r.layers && r.expectOverlay !== false && String(r.route).includes("::"))
    lines.push("  NO OVERLAY FOUND — selector did not open anything");
  if (lines.length) console.log(`${r.route} [${r.viewport}]\n${lines.join("\n")}`);
}
console.log("\n=== unparsed text colours (skipped by the contrast check) ===");
{
  const u = new Map();
  for (const r of report.routes) for (const x of r.unparsed ?? []) u.set(x.color, x);
  console.log(u.size ? [...u.values()].map((x) => `${x.color} on ${x.el}`).join("\n") : "none");
}
console.log("\n=== console errors ===");
console.log(report.consoleErrors.length ? report.consoleErrors.slice(0, 20).join("\n") : "none");
console.log(`\n${bad}/${report.routes.length} route-renders flagged · screenshots in ${OUT}`);