## What this is

One verified set of changes: the Liquid Glass visual-QA pass plus the harness that found the defects, together with the section leaderboard / onboarding / availability work it was verified against.

## The audit harness

`scripts/ui-audit.mjs` drives headless Chromium over 7 routes plus scripted interactions (leaderboard Sections tab, both profile popovers, the squad player dialog, and all 8 admin tabs) at 1440x900 and 390x844, and reports:

- WCAG contrast per text node, compositing real alpha through ancestor backgrounds and parsing `rgb/rgba`, `oklch`, `oklab`, `color(srgb)` — and now **per colour stop for gradient backgrounds**, so a badge like the captain "C" is measured against its real amber fill rather than the page behind it
- horizontal overflow, viewport spill, and text clipped without a reachable scroll container
- glass translucency + backdrop-blur stats per surface
- overlay stacking via `elementFromPoint` (catches z-index regressions that look fine in a static screenshot)
- console errors and crash detection

Flags: `--routes=`, `--viewport=`. Output: `/tmp/ui-audit/report.json` + screenshots.

## Defects found and fixed

| Area | Defect | Fix |
|---|---|---|
| `/admin` | `ReferenceError: process is not defined` — `SeasonTab.tsx` imported `TRANSITION_CONFIRM_PHRASE` from `@/convex/admin`, dragging `_generated/server.js` into the browser bundle | constant moved to the dependency-free `src/convex/configDefaults.ts`; `convex/admin.ts` re-imports it |
| Squad market | invalid nested `<button>` ("Picked by N managers" inside the card button) made the browser reparent the card and break the layout | `span role="button"` with Enter/Space handling |
| House badges | brand text at 4.38-4.4:1 | `hexLuminance` + `readableTextColor` in `houses.tsx` lightens dark brand colours toward white |
| Brand swatches | white text on amber at 2.03:1 | new `readableTextOn()` picks ink vs white |
| Destructive button | white on `#f87171` at 2.77:1 | dark ink in `ui/button.tsx` |
| Muted metadata | activity timestamp 3.36:1, footer 4.02:1, About & Credits 4.24:1, market stat line 4.49:1, two rival-inspector lines | raised to AA-passing tokens |
| Mobile layout | dashboard CTA row and award rows clipped; admin grids overflowed at 760px; tab bar clipped at 390px | `flex-wrap` / `min-w-0` on the truncating grid items, wrapping `TabsList` |

## Verification

- `node scripts/ui-audit.mjs` -> **0/38 route-renders flagged**, no console errors, no unparsed colours. Glass confirmed translucent (header 0.6/24px, cards 0.55/24px, popovers 0.72/32px, dialog 0.78/40px); overlays `z=50`, blurred, `onTop=true` at both viewports.
- `bun run typecheck` -> exit 0.
- Preview serves HTTP 200 on the managed port.

`isolate/` build output is intentionally **not** part of this change set.
