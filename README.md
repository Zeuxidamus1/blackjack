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

## GP economy expansion (Step 2, 2026-11-14)

The **Earn GP** tab shows the unchanged 50,000 GP daily claim and 5,000 GP low-balance recovery grant. The **Collection Log** contains the server-validated one-time collection milestones. Recovery is available only when the account has less GP than the cheapest pack (currently 1,000 GP), has no unresolved pack rewards, and has not claimed recovery in the preceding 24 hours. Collection milestones are based on distinct server-recorded pulls in Boss Loot, Clue Casket, and Pet Hunt. Rewards per category: First Find 2,000 GP; Scout 5,000 GP; Collector 12,000 GP; Veteran 25,000 GP; Complete 50,000 GP.

The Supabase implementation is in `supabase/migrations/20261115020722_challenger_progression_gp_rewards_and_recovery.sql`. Player balances, pack prices, reward probabilities, and existing daily claim amounts were not modified. The server uses an existing transaction advisory lock, validates the authenticated player, and stores milestone and recovery claims in protected tables with no client-table privileges. Never award GP based on client-supplied achievements, requests, odds, or prices. A recovered or claimed reward is never paid twice inside the eligible period. See `tests/economy.spec.js` for browser regression tests.


### Earn GP layout and cooldowns

The two earn cards are compact on phones and display **Next available claim in HH:MM:SS** while on cooldown. The UI calls `ChallengerEconomy.tick` once per second, using the same server clock offset as the existing daily claim timer; reopening the page does not restart the cooldown. The publicly labeled **Bonus GP** card replaces the UI label **Low-balance recovery** and omits the old eligibility explanation, while the server-side GP threshold, 24-hour cooldown, pending-pack guard and 5,000 GP grant remain unchanged. Both cards show **Claimed** while counting down.

The Collection Log uses its existing pack progress controls and filter to show unclaimed milestones with progress bars and claim buttons; the All packs view has expandable pack sections to reduce scrolling. Claiming a milestone removes it from the visible reward list immediately after the server confirms settlement. Empty categories show a completion state. Claim amounts, progress and entitlement are never generated by frontend code.

### Collection Log consolidation

Collection Log now contains the milestone GP reward board immediately below the collection progress cards. Selecting a pack with a progress card or the Pack filter displays that pack's items **and** its outstanding milestone rewards; selecting All packs shows outstanding milestones across all categories. Claimed milestones disappear from the board after server confirmation, but the existing collection discovery history and completion percentage remain visible. The Earn GP page contains only the existing Daily GP and Bonus GP claim cards with their cooldown timers. The API actions `economy_status` and `economy_claim`, server-owned reward eligibility, claim history, amounts, and wallet logic are unchanged.

## Daily and weekly missions (Step 3)

The premium Missions tab includes six server-authoritative objectives:

| Frequency | Objective | GP reward |
| --- | --- | ---: |
| Daily | Open 3 mystery packs | 2,000 |
| Daily | Collect 2 different items | 4,000 |
| Daily | Sell 3 items | 3,000 |
| Weekly | Open 25 mystery packs | 25,000 |
| Weekly | Collect 8 different items | 30,000 |
| Weekly | Sell 15 items | 18,000 |

Daily missions reset at 00:00 UTC. Weekly missions reset on Monday at 00:00 UTC. Reset countdowns appear in the Missions tab. Mission rewards are credited atomically, only when server-computed progress meets the target, and only once per mission per period. Browser clients cannot supply progress counts or GP amounts.

Progress derives from authenticated pack purchases (batches.quantity), different item types revealed within each period (batches and batch_rewards), and verified new sales (sales.seller). New GE sales, bulk sales, reward-reveal sales, and market trades now attribute sales to the actual seller. Historical sales remain untouched and cannot be retroactively credited if they lack seller information.

Schema: supabase/migrations/20261114145000_mission_sales_owner.sql and supabase/migrations/20261114150000_daily_weekly_missions.sql. Frontend: missions.js and missions.css. Browser coverage: tests/missions.spec.js. Existing GP accounts, inventory, game odds, transactions and purchases remain intact.


## Step 4: Shared premium storefront

Boss Loot, Clue Casket, and Pet Hunt use the **same** horizontal drag-and-swipe carousel, pack details, quantity selector (1–5), premium What's Inside rewards, and full-screen opening/reveal interface. Each Clue and Pet tier has a distinct cosmetic collectible-pack design. Use the compact category chips above the carousel to change pack families without returning to the old case grid.

The existing Supabase case IDs, prices, reward pools, weights, accounts, GP balances, and inventory are unchanged. Clue and Pet tiers have the same existing purchase values. Pet Hunt has non-GE, custom guide values; its preview identifies them correctly, and its GE sale action is disabled when no verified tradable quote exists, leaving Vault available.

Implementation is shared in `index.html` and `premium-packs.css`, with the unchanged underlying secure reveal workflow in `reveal.js` and its supporting CSS. The PWA caches the shared styling. `tests/premium-categories.spec.js` covers the category artwork, switching, swipe/drag, reward previews, purchases, vault flow, and mobile layout using mocked accounts rather than real GP purchases.
