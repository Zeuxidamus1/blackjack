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
