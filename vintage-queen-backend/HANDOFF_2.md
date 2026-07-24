# Handoff notes - continue backend work in Claude Code

Session date: 2026-07-24. Picks up after HANDOFF_1.md was fully implemented
(Clover/Asana integration, item import, channel classification, approval-gated
statement delivery, Render deployment prep - all merged). This session found
a significant new problem while validating the numbers: **the current data
only reflects ~27 days of sales, not full history, and there are far more
than 25 consignors actually selling.** Nothing has been resolved yet - this
is where to pick back up.

## The core problem: order sync only covers the last ~1000 orders

`clover.js`'s `getOrdersSince()` and `getItems()` both call Clover with
`limit: 1000` and no pagination. Verified directly against the live account:

- **Total orders in the Clover account: 35,742, going back to 2023-09-26.**
- The 1000-order pull only reaches back to **2026-06-27** (about 27 days).
- Nearly every currently-active consignor's `contract_start` in Asana
  predates that window (some back to March 2026), meaning there are almost
  certainly unsynced sales for most of them between their contract start and
  6/27 that the app has never seen.

**Confirmed with the owner:** consignors are already paid up if their
contract has ended (some prior/manual process handled that before this
system existed) - so this is NOT "go sync all 3 years and pay everyone from
2023." The right scope is narrower, but hasn't been pinned down yet. Needs a
real backfill strategy: pagination in `clover.js` (proven to work manually,
not yet built into the app), then sync back only as far as needed for
consignors with genuinely still-open/unpaid balances.

## Also unresolved: storefront statements can double-count

`generateStorefrontStatements()` sums **every** `sold_store` item with no
date window and no "already paid" tracking. Run it twice and it reports the
same cumulative total both times. Owner clarified the actual payout model:

- **Direct consignors get paid once** - a single final statement when their
  contract ends.
- **Estate consignors get paid twice** - the estate-day payout, plus one
  final storefront statement for any leftovers that sold later.

Needs a real "paid" marker (on items or reports) so a statement only ever
covers sales since the last one for that consignor - not built yet.

## July 2026 sales audit (real Clover data, done this session)

775 orders created in July, 2,006 line items (refunds and one literal
"Manual Transaction" line excluded), **$49,063.70 gross**.

- **"IETS" category = house stock, confirmed.** All 461 line items named
  "9000..." in July fall under the Clover category literally named "IETS"
  ($7,363.66). This is already correctly excluded from consignor payouts
  (the code match is on the "9000" prefix in the item name, not the Clover
  category), this just explains what "IETS" actually is - not a mystery
  unmapped consignor.
- **"(no category)" = $3,513.00, 108 items** - a mix of real consignor items
  that were never assigned a Clover category (e.g. `SB1 Misc`, `Niel3 Misc`,
  `PER4 MISC`, `EG 8/10 Misc`, `EC5/10 MISC`, `Harm15 Misc`, `Foltz114 Snow
  Farm Scene Painting`, `DIEB94 Cermonial Tribal mask`), plus one "Manual
  Transaction" line that isn't a real sale at all. These still parse fine by
  code (parsing doesn't depend on Clover's category field) - they're just
  unmapped codes, same as everything below.

### Category audit: mapped vs identified vs unidentified

Of 62 distinct consignor categories seen in July (excluding IETS):

**23 already mapped** (current `CODE_BY_TASK_GID` in `seed.js`): TUCK, MAHER,
ROX, KNOX, CHAMB, DOBB, MONEY, PETE, SUHA, HEN, DCOX, BENN, RUTER, CBRU,
COLS, JBEN, LFAIR, SMC, RM, JJ, SDAN, MCK, ANTT.

**~17 identified in Asana but not yet mapped** (name match confirmed, code
and contract status not yet pulled) - real money involved:

| Category (Clover) | July total | Asana task |
|---|---|---|
| Allari Barbara (Abar) | $3,392.54 | Allari, Barbara - Jenny Horning contact |
| PRICE, BRIAN (PRICE) | $3,172.00 | Brian Price |
| Moore, Ron | $2,000.00 | Ron Moore |
| Pippa Fesjian (Pip) | $1,033.00 | Fesjian, Pippa |
| WOREK, MOLLY (MWOR) | $964.00 | Molly Worek |
| WESCOTT, HERB (WEST) | $923.00 | Herb Wescott |
| Smith, Dana (SD) | $725.00 | Dana Smith |
| BRUSS, TERRY (Bruss) | $659.00 | Terry Bruss |
| THOMPSON, DAVE (DT) | $430.00 | Dave Thompson |
| Turner Julie | $345.00 | Julie Turner |
| HEATH, NANCY (HEA) | $295.00 | Heath, Nancy - Chris Heath |
| LAND, Lorraine (Lland) | $237.00 | Cindy Kudar (Land, Lorraine) |
| HUBBLE, KATI (HUBB) | $226.00 | Kati Hubble |
| WEBER, HAL | $225.00 | Hal Weber |
| Meyer, Chazie (Chaz) | $130.00 | Chazie Meyer - Melissa Thompson |
| Woods, Greg (Wood) | $125.00 | Greg Woods |
| MOORE, JIM (JIMM) | $64.00 | Reichel, Jim (unconfirmed - worth double checking, "Jim Moore" isn't literally the same string as "Reichel, Jim") |
| Britton, Brian (BB) | $49.00 | Britton, Brian |
| Walker, Gayle (Wal) | $23.00 | Glenn Allen Walker (name mismatch - Gayle vs Glenn, double check) |
| RUTER, ROD (RR) | $18.00 | Rod Ruter - **see note below, likely same person as mapped RUTER** |
| CROWLEY, ATHENA (CROW) | $8.00 | Crowley, Athena |
| Dana Larrondo (Larr) | $8.00 | Larrondo, Dana |
| VENABLE, CAROL (VEN) | $8.00 | Venable, Carol |
| BRENNAN, MIA (MIA) | $5.00 | Brennan, Mia |

**Rod Ruter data issue:** two different Clover categories exist for what's
probably the same person - `RUTER (Ruter)` ($28, already mapped to code
`RUTER`) and `RUTER, ROD (RR)` ($18, not mapped). If they're the same
person, his `RR`-tagged sales are currently invisible to sync. Needs
confirming, then either map `RR` as an alias or fix the Clover tagging.

**22 categories not confidently matched to any Asana task** (strict
name-matching only - no loose guessing, to avoid wrongly attributing money):

| Category | July total | Notes |
|---|---|---|
| Helen Haause (Haau) | $2,375.00 | Likely "Helen Hause" in Asana - spelling mismatch (extra "a") |
| POPE (Pope) | $1,283.50 | Not found - "James Pope" exists in Asana as a *historical/completed* task, not obviously the same |
| Hedi Munroe (Mun) | $961.00 | Not found under this exact spelling |
| Haskel (Hask) | $859.00 | Not found - "Haskell, Greg and Kelly" exists but is a different code (WOOD, above) |
| Knickbocker (Knic) | $668.00 | Not found |
| Grill, Beth (Grill) | $668.00 | Likely "Grill, Elizabeth" (historical/completed task) - Beth/Elizabeth nickname mismatch |
| ISENBERG, SARAH (ISEN) | $394.00 | "ISENBERG, SARAH" exists in Asana's historical/completed list |
| COTTINGHAM (TC) | $187.00 | Not found in Asana at all |
| McMinn, Joy (Mcm) | $145.00 | Not found under this exact spelling |
| Eccles, Cheryl (Cecc) | $137.00 | Likely "Cherly Eccles" in Asana - transposed-letter typo |
| SIMON, CHRIS (SIMON) | $125.00 | Likely "Chris Simone" (historical/completed) - spelling mismatch |
| GENTILMAN, PEBBLES (PEB) | $124.00 | Likely "Pebbles, Gentlemen" - flagged as an ambiguous stray task earlier this project; turns out to be a real consignor with real sales |
| GALLUP, TODD (TODD) | $106.00 | Not found under this exact spelling ("TODD, GALLUP" pattern differs) |
| Riccardelli (Ric) | $103.00 | Likely "Riccardelli, Marie - Nick Meo" (historical/completed) - single-word category, matcher too cautious to confirm |
| Lane, Nicole (Lane) | $90.00 | "Lane, Nicole" exists in Asana's historical/completed list |
| Larry Roberts (Rob) | $75.00 | Not found in Asana at all |
| VQMH2 | $16.00 | Doesn't look like a person - possibly a register/test category, not a consignor |
| Loepp (BL) | $12.00 | Code `BL` was seen in Clover categories earlier this project but never matched to an Asana task |
| Harper Estate (MH) | $10.00 | Not found ("Filler Estate" exists but is a different estate) |
| Ray, Jana (Ray) | $9.00 | Not found in Asana at all |
| Roberts, Heidi (HR) | $8.00 | Not found under this exact spelling |

## Still open from before this session (unchanged)

- **Deployment**: Render chosen, `render.yaml` + `package.json` engines +
  self-configuring approve links (via `RENDER_EXTERNAL_URL`) all ready to go.
  Owner isn't adding billing yet - **paused, not blocked on anything from
  this end.** When ready: render.com -> connect GitHub -> New -> Blueprint ->
  select this repo -> fill in the `sync: false` env vars from `.env`.
- **SMTP**: `accounting@idahoets.com` credentials are in `.env` but
  **unverified** - this sandbox only allows outbound HTTPS, so a raw SMTP
  connection on port 587 times out regardless of whether the password is
  correct. Can't be tested until deployed somewhere with normal network
  access.
- **No text messages** (owner decision) - consignors with no email get
  flagged for manual outreach in the review/digest email instead.
- **`ASANA_TOKEN`** still isn't set - this session only had Asana access
  through Claude Code's MCP connector, not a standalone API token, so
  `npm run seed` can't run outside a Claude Code session yet. A cached
  snapshot of the Asana project (as of ~23:37 UTC 2026-07-23) was used for
  everything in this session in place of live calls when the connector
  dropped mid-session - worth a fresh pull next time before trusting numbers
  that depend on Asana data specifically (contract dates, email, etc.),
  since a day may have passed.

## Suggested next steps, in order

1. Pull full contract status (Asana) for all ~39 newly-found categories
   above - sort into "active contract, still owed" vs "contract already
   ended, already paid, nothing to do" vs "genuinely not in Asana, needs the
   owner to say who this is."
2. Resolve the Rod Ruter dual-category question.
3. For anyone confirmed "still owed," add them to `CODE_BY_TASK_GID` in
   `seed.js` (need their contract dates from Asana either way, same as the
   original 23).
4. Add pagination to `getOrdersSince()`/`getItems()` in `clover.js` (proven
   to work via manual testing this session - `offset`/`limit` params, loop
   until a page comes back short). Needed regardless of the answer to #1,
   since the app currently can't see anything before 6/27 no matter what.
5. Decide and implement how far back to actually sync once #1 narrows down
   who's really owed money - probably back to the earliest still-open
   consignor's `contract_start`, not a blind full-history backfill.
6. Add a "paid" marker so `generateStorefrontStatements()` stops re-summing
   already-reported sales every time it runs.
7. Everything else from HANDOFF_1 that's still open: deployment billing,
   SMTP verification, ASANA_TOKEN, Mitzi Jenson/Patrick Connor (still
   nothing to map - confirmed not in Clover yet).
