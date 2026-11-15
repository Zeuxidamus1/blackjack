# Challenger Rips

A free, non-cashable Old School RuneScape fan game with server-side GP wallets, collectible pack openings, an item collection, player market and showcase.

## Boss Loot

Ten draggable/swipeable collectible packs range from **1,000 GP** (Starter Loot) to **5,000,000 GP** (God Tier Loot). Every tier has unique artwork with RuneScape-themed cover icons, a reward preview, the minimum and maximum eligible GE values, server-calculated actual odds and a one-in-a-million jackpot item. Open one, two, or five packs per purchase. Mouse dragging, touch scrolling and pack snap selection are supported.

Boss reward pools currently contain ten existing, GE-backed catalogue items per tier. The database recomputes value-sensitive weights with an expected-value target of 72% of pack cost; real item prices and actual computed probabilities are shown without guaranteed profit. The server samples a 1,000,000-ticket draw and the displayed weights are the exact weights used on the backend. Purchase/odds version and reward-value snapshots are stored for new batch rewards.

## Price integrity

The authenticated Supabase \`challenger-ge-refresh\` Edge Function obtains OSRS Wiki real-time GE quotes for the actual item IDs and synchronizes validated prices to the server catalogue. Requests are globally throttled to once per 15 minutes and are triggered by active authenticated sessions. Inactive periods will not refresh automatically unless an external schedule is configured. Verified GE quotes can be used for direct sales for up to 72 hours after their actual last trade timestamp. Quotes older than 24 hours are visibly labeled as older and require user confirmation; quotes over 72 hours or unavailable block selling until a refreshed quote is available. No market value is invented. Players cannot supply their own listing or GE sale price. Existing player listings reprice to validated guides when the catalogue is updated. Item artwork is served from RuneLite icons.

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

Reward decisions are persistent and owner-authorized. New rewards stay \`pending\` until they become \`vaulted\` or \`sold\`. Pending items are kept out of the ordinary market/inventory actions and cannot be bypass-sold. Exact server-side inventory instances are tracked; multi-reward selling is one atomic, idempotent database transaction that uses verified Grand Exchange quotes for tradable items and server-assigned GP values for nontradeable pets, while vaulting preserves the item. Closing or reloading the page does not delete unreviewed rewards: use **Resume opening** to continue.

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

The shared carousel retains the original Supabase case IDs, pack prices, accounts and inventories. Nontradeable Pet Hunt rewards use server-assigned GP values and can be sold in the reveal or inventory, subject to ownership and protection checks. Tradable items retain fresh, verified Grand Exchange sale prices.

Implementation is shared in `index.html` and `premium-packs.css`, with the unchanged underlying secure reveal workflow in `reveal.js` and its supporting CSS. The PWA caches the shared styling. `tests/premium-categories.spec.js` covers the category artwork, switching, swipe/drag, reward previews, purchases, vault flow, and mobile layout using mocked accounts rather than real GP purchases.


## Collection Log: every item must be obtainable

The 2026-11-15 reward-pool coverage audit found 522 items in `rips.catalog` that were not in any `rips.case_rewards` pool: 14 Boss Loot, 443 Clue Caskets, and 65 Pet Hunt. The migration `supabase/migrations/20261115010000_complete_collection_reward_coverage.sql` assigns each missing item to an existing category-appropriate case.

After the migration there are **877 catalog items, zero unobtainable items, 16 valid reward pools**, each totaling 1,000,000,000,000 draw tickets. All 10 Boss Loot cases still meet their original 72% target returns. Clue/Pet cases use expanded precision; the newly included rewards collectively receive 2% probability in the affected cases, and historical rewards retain 98% of their original odds there. Pack prices, player GP, inventories, existing rewards, and past purchases are unchanged. The draw denominator in `rips.command` is now consistent across all packs.

This is a live data coverage requirement, not a display filter. Every time catalog items or pack pools are added, verify:

```sql
select count(*) as unobtainable
from rips.catalog i
where not exists (
  select 1 from rips.case_rewards r
  join rips.cases c on c.id=r.case_id
  where r.item=i.id and r.weight>0
);

select c.id, sum(r.weight) as tickets
from rips.cases c join rips.case_rewards r on r.case_id=c.id
group by c.id
having sum(r.weight)<>1000000000000;
```

Both queries must return zero or no rows respectively. The Collection Log's **More Info** control also refreshes stale case lists if an item appears to have no source, so existing PWA sessions pick up newly added pack assignments.


## Step 5: Inventory dashboard, protection and duplicate tools

The RuneScape Inventory tab now includes a compact two-card dashboard showing **combined guide value** and **total items with unique-type count**. This is an *estimate* based on currently stored GE or custom item guide values, not a guaranteed cash-out amount. GP wallet balances are separate.

Players can search inventory by item name, filter by sale eligibility, duplicates, protection, listing, or pack family, and sort by acquisition time, guide value, best actual pack rarity, name, or copy count. The optional **Stack duplicates** control displays identical items together without merging their separate server-owned instances; stacks expand into individual items.

**Protect item** persists per instance through Supabase (new `rips.items.protected` flag). Protection is enforced server-side against individual GE sales, atomic multi-item GE sales, marketplace listing, and duplicate salvage. Listed or pending rewards cannot have their protection changed. **Select spare duplicates** marks eligible extra copies while retaining one of each item type; any protected copy is always kept. The existing 100-item limit and server-verified GP sale settlement still apply.

Database migration: `supabase/migrations/20261115023000_inventory_protected_items.sql`. Frontend: `index.html` and `inventory-step5.css`. Mobile PWA assets include the new styles. Playwright tests extend `tests/reveal.spec.js` to cover the dashboard, sorting, filtering, protection, bulk-sale exclusion, duplicate expansion, and phone layout.

## Restricted moderator test GP

The verified Supabase Auth account with the player name **zeuxidamus** is granted the `moderator` role using its immutable account ID (not mutable user metadata or a client-provided username). This role currently provides **only one extra privilege: adding test GP to its own player wallet**. It does not confer moderation of other accounts or balances.

When logged in, the account receives a private **Moderator Tools** navigation tab. The console shows the live GP balance, shortcut buttons, a custom amount field, and recent adjustments. Each request adds **1 to 1,000,000,000 GP**, requires the account owner's confirmation, and is recorded in `rips.moderator_gp_audit`. Moderator GP is ordinary in-game GP (not real currency), so using it to open or sell packs affects the same production game economy. The user's starting GP is not automatically changed by installing this feature.

Authorization is enforced in the protected Supabase `rips.moderator_tool` function, called via the existing authenticated `public.rips_command` API: `moderator_status` to read the role and own audit history, and `moderator_gp_add` to add GP. The audit table and role table have RLS enabled and no direct client privileges. Only the staff member's own wallet can be modified, repeated request UUIDs cannot grant GP again, and GP never exceeds the existing 9 trillion wallet limit.

Implementation: `supabase/migrations/20261115030000_moderator_own_gp_testing.sql`, `moderator.js`, `moderator.css`, and the guarded navigation/actions in `index.html`. Browser coverage in `tests/moderator.spec.js` uses mocked accounts and does not change actual GP. This moderator account should be identified separately from normal players if adding competitive leaderboards in Step 6, so injected testing GP does not distort rankings.

## Pet Hunt rarity pricing and fair odds (2026-11-15)

Migration: `supabase/migrations/20261115095000_pet_hunt_rarity_values_and_72_percent_odds.sql`. Pet Hunt had 83 non-GE rewards sharing only seven custom price levels, and existing premium rewards could have massively different probabilities but identical values. The migration now gives each of those **83 pets its own deterministic, server-owned GP guide value**. Two genuine GE-traded rewards in Starter retain their GE IDs and market prices.

**Rarity groups:** Starter/Common 450–750 GP; Starter/Select Uncommon 1,250–2,150 GP; Select Rare 12,000–18,000 GP; Premium Common 3.5M–7M GP; Premium Uncommon 9M–16.5M GP; Premium Rare 18M–37M GP; Premium Epic 42M–77M GP; Legendary jackpot Mr McGroot 150M GP. Values are in-game rewards, **not claims about tradeability or prices in OSRS**.

Actual case weights are recalculated with a monotonically decreasing value-based power weighting and largest-remainder ticket allocation. Each of the three cases has exactly 1,000,000,000,000 tickets, every reward remains obtainable, the jackpot stays exactly 1 in 1,000,000, and the server-verified expected payout is **72.0000% of pack cost** (720 GP Starter; 2,880 GP Select; 8,640,000 GP Premium). Higher-valued items always have lower chances within the same pack. Source updates increment all three Pet Hunt configuration versions. No purchases, GP balances, inventory instances, drop history, completed sales or prior snapshot fields were modified. Existing pending or owned pets use current server guide values when sold, as with the preexisting economy rules.

The premium storefront's What's Inside popup lists pets by rarity, displays distinct values, and shows actual server draw odds rather than legacy catalog weights. The collection and inventory use the same values and authentic icons. Pet selling remains available from the reveal and from inventory/bulk selling. In-game values are read-only to clients; payouts are made server-side with existing owner verification. Relevant browser tests: `tests/premium-categories.spec.js`.

## Inventory cleanup and sell stale GE items (2026-11-15)

The inventory summary displays only Inventory guide value and Total items. The Extra copies and Most valuable item summary cards are removed (the functional duplicate filters, stacking, protection and per-item controls are preserved). The RuneScape hero no longer repeats the promotional "Spend GP on packs" sentence or the Next claim in timer. The detailed claim countdown remains on the Earn GP tab.

Some OSRS Grand Exchange items, including Light tuxedo cuffs (item 19976), have no trade in the prior 24 hours despite a valid last traded value. These are now sellable for their **last verified, server-stored GE quote** for up to 72 hours. The inventory labels quotes older than 24 hours and the sale confirmation explicitly discloses their age. Beyond 72 hours the interface offers Refresh GE quote, while sales remain blocked at the backend. No fake timestamps, fallback market values, client-submitted GP amounts or ownership bypasses are used.

Database: `supabase/migrations/20261115102000_allow_verified_ge_sales_within_72_hours.sql` updates reward settlement, individual selling and bulk selling using the same 72-hour rule. Frontend: `index.html` and `inventory-step5.css`. Tests: `tests/reveal.spec.js` includes both an eligible 34-hour trade and an ineligible 80-hour trade.
