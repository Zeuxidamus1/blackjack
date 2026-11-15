# Challenger Rips

A free, non-cashable Old School RuneScape fan game with server-side GP wallets, collectible pack openings, an item collection, player market and showcase.

## Boss Loot

Ten draggable/swipeable collectible packs range from **1,000 GP** (Starter Loot) to **5,000,000 GP** (God Tier Loot). Every tier has unique artwork with RuneScape-themed cover icons, a reward preview, the minimum and maximum eligible GE values, server-calculated actual odds and a one-in-a-million jackpot item. Open one, two, or five packs per purchase. Mouse dragging, touch scrolling and pack snap selection are supported.

Boss reward pools currently contain ten existing, GE-backed catalogue items per tier. The database recomputes value-sensitive weights with an expected-value target of 72% of pack cost; real item prices and actual computed probabilities are shown without guaranteed profit. The server samples a 1,000,000-ticket draw and the displayed weights are the exact weights used on the backend. Purchase/odds version and reward-value snapshots are stored for new batch rewards.

## Price integrity

The authenticated Supabase \`challenger-ge-refresh\` Edge Function obtains OSRS Wiki real-time GE quotes for the actual item IDs and synchronizes validated prices to the server catalogue. Requests are globally throttled to once per 15 minutes and are triggered by active authenticated sessions. Inactive periods will not refresh automatically unless an external schedule is configured. If prices are unavailable or older than 24 hours, direct GE sale is blocked; no market value is invented. Players cannot supply their own listing or GE sale price. Existing player listings reprice to validated guides when the catalogue is updated. Item artwork is served from RuneLite icons.

## Platform

The site is published via GitHub Pages at https://zeuxidamus1.github.io/blackjack/. Supabase Auth, Postgres, and Edge Functions handle authorization, prize selection, balances, purchase idempotency, owned items and transactions. The browser receives only the Supabase publishable key. The service role key remains in the server environment.

Supabase migrations are in \`supabase/migrations/\`; the final Boss Loot schema/code migration is \`20261114060000_boss_loot_v2.sql\`. The deployed Edge Function source is in \`supabase/functions/challenger-ge-refresh/index.ts\`.

## Test

\`\`\`bash
npm install
npx playwright install chromium
npm run test:e2e
\`\`\`

Tests mock backend values rather than spending actual GP. GitHub Actions runs desktop and mobile-width Playwright checks on changes.

This is a fan game with digital, nonredeemable GP. No real-money purchases, real-world cash-out or links to RuneScape accounts.


## Premium pack-opening / reward review (2026-11-14)

Single purchases use a fullscreen OSRS item reveal with Sell / Vault. Purchases of two to five packs begin with an animated seal, then individual 3D-flip cards and a selectable reward grid. The totals, item artwork and Sell All / Vault All controls update as rewards are selected or handled. A pack opens only after a sufficiently long horizontal touch or mouse swipe (with an accessible keyboard alternative). The gesture drives a luminous light sweep across a metallic foil seam, followed by a brief seal peel and reward reveal. There is no automatic opening, skip button or tap-to-speed-up behavior.

**Permanent pack opening UI rule:** Keep the unopened pack screen visually clean. Never add visible helper text, swipe directions, instruction banners, reassuring security notes, purchase selection disclaimers or similar explanatory copy. In particular, do not restore "SWIPE TO RIP", "Rewards were securely selected when you purchased", "Tap to speed up" or a "Rip open your pack" instruction. Let the animation communicate the gesture. Use nonvisual accessible labels on interactive controls when necessary. Do not modify server-authoritative GP or reward behavior to achieve visual effects.

Reward decisions are persistent and owner-authorized. New rewards stay \`pending\` until they become \`vaulted\` or \`sold\`. Pending items are kept out of the ordinary market/inventory actions and cannot be bypass-sold. Exact server-side inventory instances are tracked; multi-reward selling is one atomic, idempotent database transaction that uses current, validated Grand Exchange quotes, while vaulting preserves the item. Closing or reloading the page does not delete unreviewed rewards: use **Resume opening** to continue.

Implementation: \`reveal.js\` + \`reveal.css\`; database migrations \`20261114070000_premium_reward_sessions.sql\` and \`20261114071000_protect_pending_rewards.sql\`. Playwright tests in \`tests/reveal.spec.js\` exercise all quantity layouts, single and partial settlement flows, reload/resume and mobile widths with a simulated backend. Live account purchases are not used during browser tests.


## Install Challenger Rips on a phone (PWA)

Challenger Rips installs directly from https://zeuxidamus1.github.io/blackjack/ on supported Android and iPhone browsers, with a custom icon and standalone display. The game is still hosted by GitHub Pages and uses its existing Supabase backend.

Android: open the site in Chrome, then use Install app or the three-dot browser menu. iPhone: open in Safari, tap Share, select Add to Home Screen, enable Open as Web App, then Add. The header has an install button and device-specific instructions where available. No APK or app-store membership is required.

PWA configuration: manifest.json, app-install.js, sw.js, offline.html, and icons/. The service worker is scoped to the GitHub Pages /blackjack/ directory. It caches only static install assets and an offline page, never GP balances, Supabase requests or authenticated transactions. Pack opening, inventory and payments require internet. GitHub Pages deployments update the app's online content.

Test by running npm run test:e2e; tests/pwa.spec.js covers manifest, icons, install prompts, phone viewport, offline page and registration, along with the existing Boss Loot regression suite.
