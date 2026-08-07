# Handoff notes - continue backend work in Claude Code

Session date: 2026-07-24, continued 2026-07-25. Picks up after HANDOFF_1.md
was fully implemented (Clover/Asana integration, item import, channel
classification, approval-gated statement delivery, Render deployment prep -
all merged). Found a significant new problem while validating the numbers:
**the app only ever saw ~27 days of sales, not full history, and there are
far more than 25 consignors actually selling.**

**Update (2026-07-25): pagination fixed, full historical sync run, real
totals now known - and they're much bigger than yesterday's numbers.**

`clover.js` was capped at 1000 results per call with no pagination -
`getOrdersSince()` and `getItems()` now page through with `offset` until a
short page comes back. Confirmed this was live, active data loss (not just
theoretical): re-ran a sync in a clean test db and three of Rod Ruter's real
July sales silently vanished because they fell outside the unpaginated
window. Full paginated pull: **36,279 total orders, 26,895 total items** -
both numbers were previously invisible past the first 1000.

Ran the full pipeline (seed -> import-items -> sync -> reports) against
complete history. Also found and fixed a second real bug while doing this:
`generateEstatePayoutReports()` only ever fired when a consignor's payout
due date exactly equaled today - since this app never ran as a continuous
live service before, **4 of 5 estate consignors had payout dates that had
already passed with zero report ever generated.** Fixed to catch up on any
overdue date, not just an exact match (see reports.js commit).

### Real current-owed totals (first full-history backfill)

**Estate payouts - $36,000.70 total, all overdue, none previously reported:**
Chris Brule $11,028.25, +Anothony/Cindy Maher $10,827.31, Smith Estate/
Roxanne $9,988.20, Sue Daniel $4,156.95, Shirley Mcdermott $0.

**Owner said: don't chase these past estate payouts** - leave them alone,
don't send anything for them. Presumably already handled outside this
system before it existed, consistent with the standing "already paid if
contract ended" rule. Nobody's been contacted about them either way - they
were only ever computed in local test runs, never a deployed/live system.

**Storefront statements - $24,214.49 total across 23 consignors** at that
point (mostly still accruing - only Ben Hendry's contract had ended so far).

**Grand total at that point: $60,215.20** - compare to the ~$6,376
storefront-only estimate from the 27-day-window data the day before. This
is why the pagination bug mattered as much as it did.

### Update: 8 more consignors mapped, totals now even higher

Asked the owner for contract dates on the 10 people who were active in
Clover but missing `contract_start`/`due_on` entirely. They went into Asana
and filled in what they could. Re-pulled fresh data and found:

- **8 of 10 now complete**, mapped: Barbara Allari (`ABAR`), Brian Price
  (`PRICE`), Pippa Fesjian (`PIP`), Herb Wescott (`WEST`), Brian Britton
  (`BB`), Jim Moore (`JIMM`), Greg Woods (`WOOD`), Dana Larrondo (`LARR`).
- **2 still incomplete**: Dana Smith (both `contract_start` and `due_on`
  still null) and Hal Weber (`due_on` present, `contract_start` still null).
- Also found **2 brand-new Asana tasks** that appeared since the last pull,
  both complete from the start (real contract dates, email, phone): **Greg
  Fairbourn** (matches Clover category "Fairbourn, Greg (Gfa)", $98 seen in
  the original July audit - mapped as `GFA`) and **Tania Hansen** (entirely
  new name, contract just started 8/4, no Clover sales yet - nothing to map
  until she has activity).

Re-ran the full pipeline with all of this in place:

- **Storefront total jumped from $24,214.49 to $45,209.36** - the 8 newly
  mapped consignors added real money, notably Barbara Allari $4,612.00,
  Brian Price $4,147.50, Pippa Fesjian $4,005.38, Brian Britton $3,638.99.
- Estate total basically unchanged ($35,961.70 - small drift from new
  orders landing in the live sandbox between runs).
- **New grand total: $81,171.06.**
- Note: Herb Wescott's storefront statement came back **"payable now"**
  (his `due_on` of 6/10 has already passed) - **owner said to treat this
  the same as the past estate payouts: leave it alone, no action.**

Now 34 consignors seeded total (25 + 8 newly-dated + Greg Fairbourn, a
brand-new complete Asana task that appeared mid-session, matching a Clover
category already seen in the original July audit). 1 skipped - Tania
Hansen, another brand-new complete task, but no Clover sales yet so no
code to map. 49 skipped for missing contract dates (mostly historical/
completed tasks that predate contract tracking, not urgent).

## Fixed: reports no longer double-count the same sale

Both report jobs previously summed *every* sold item every time they ran,
with nothing marking what had already been reported - harmless so far only
because nothing had actually been sent yet, but it would have re-reported
(and risked re-paying) the same sales on every subsequent run once real
sending started.

Added `items.reported_in_report_id` - set the moment a sale is included in
a generated report (any delivery path: email, manual-outreach flag, or a
$0/no-op report). Both jobs now only query items where it's still `NULL`.
`server.js`'s consignor dashboard had the identical issue (summed all-time
sold items as "owed" regardless of report status) - split into `owedEstate`/
`owedStore` (unreported only) and a separate `reportedTotal` for the
lifetime paid/reported figure, so a consignor's portal won't show something
as still-owed after it's already been reported.

**Verified with a real test**: ran the full pipeline twice back to back
with no new sales in between. Run 1: $35,961.70 estate + $45,945.36
storefront (39 reports with money owed). Run 2: **zero** new reports with
anything owed - every item had already been claimed by run 1's reports.
Cumulative totals identical before and after run 2, confirming nothing got
double-counted.

None of these numbers have been approved/sent to anyone - still sitting as
`pending_review`, same approval-gated flow as always (review email to
accounting@idahoets.com, nothing goes to a consignor without a click). SMTP
still isn't reachable from this sandbox, so review emails log instead of
sending. This was all computed in **local test databases** that get deleted
after each run - still needs Render deployment before any of this becomes
the actual system of record. Re-running the full pipeline once deployed
will reproduce these same numbers (modulo whatever's sold between now and
then).

Also this session: mapped Patrick Connor (`PAT`) - he now has real July
sales and a confirmed active contract in Asana, wasn't seedable yesterday.
Investigated the "Rod Ruter dual-code" question from yesterday's audit and
it turned out to be a false alarm: his items are all tagged `RUTER...` in
the text itself - the `(RR)` was just an inconsistent Clover *category*
label on some of his items, which parsing never reads. Added a
`CODE_ALIASES` mechanism to `skuParser.js` anyway (not needed for this
specific case, but this kind of inconsistent staff tagging seems likely to
recur, so the mechanism's there when it does).

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

**Rod Ruter data issue - resolved, was a false alarm.** Two different Clover
*categories* exist for the same person (`RUTER (Ruter)` and `RUTER, ROD
(RR)`), but his actual item names all start with `RUTER...` regardless of
which category they're filed under - sync.js parses the item name, never
the category, so his sales were never actually missing. What *was* missing
turned out to be the unpaginated-API bug (see top of file) - three of his
July misc sales fell outside the old unpaginated window.

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

## Update (2026-07-25): contract-status audit results, re-run with fresh data

Re-ran the category audit against a fresh Asana pull (not yesterday's cache)
and fixed a bug in the matcher itself (was matching against the raw category
string including the `(CODE)` suffix, which broke subset matching - fixed to
match against the parsed name only). Results, excluding the 23+1 already
mapped (Patrick Connor now included):

- **Nobody has a contract that's confirmed already-ended-but-unpaid** - zero
  matches in that bucket.
- **23 people matched an Asana task but have no `contract_start`/`due_on`
  filled in at all**, so contract status can't be determined from data alone:
  - **10 with `completed: false`** (likely still active, just missing
    contract dates - real money at stake): Barbara Allari ($4,197.54 in
    July alone), Brian Price ($3,435), Pippa Fesjian ($1,055), Herb Wescott
    ($923), Dana Smith ($789), Brian Britton ($399), Hal Weber ($255), Jim
    Moore ($233), Greg Woods ($125), Dana Larrondo ($14). **These need
    `contract_start`/`due_on` filled in in Asana before they can be mapped
    and paid correctly** - ask the owner.
  - **13 with `completed: true`** (per the owner's rule, likely already
    settled through whatever process predated this system - probably
    nothing to do, but flagging the total in case any should be
    double-checked): Molly Worek ($1,186), Terry Bruss ($832), Dave Thompson
    ($588), Lorraine Land ($511), Julie Turner ($449), Chazie Meyer ($304),
    Nancy Heath ($303), Kati Hubble ($290), Filler Estate ($169), Brett
    Sebring ($19), Carol Venable ($13), Athena Crowley ($8), Mia Brennan ($5).
- **26 categories still don't match any Asana task** - same list as
  yesterday, plus one new one that turned out to be mappable: **"Jensen,
  Mitzi (Mjen)", $22 in July** - Mitzi Jenson was confirmed yesterday as
  "not yet in Clover." Checked her Asana task directly: she now has both a
  Clover category (spelled "Jensen" there vs "Jenson" in Asana) *and* real
  contract dates (`contract_start` 2026-07-18, `due_on` 2026-10-25) -
  **mapped as `MJEN`**, same situation as Patrick Connor.

Only Mitzi Jenson remains from the original two "not in Clover yet"
consignors - nothing more to do there until she does.

## Suggested next steps, in order

1. Ask the owner to fill in `contract_start`/`due_on` in Asana for the 10
   `completed: false` people above - can't map/pay them correctly without
   real contract dates, and there's real money involved (Barbara Allari
   alone is $4,197.54 just in July).
2. Check whether Mitzi Jenson now has both Clover activity *and* Asana
   contract dates (like Patrick Connor did today) - if so, map her too.
3. Show the owner the 26 still-unmatched categories and the 13
   `completed: true` ones, and ask for identification / confirmation that
   the completed ones really don't need action.
4. Once the full historical sync (running now, see top of file) finishes,
   pull real current-owed totals per consignor and compare against what the
   ~27-day-window numbers showed yesterday - the real amounts are probably
   meaningfully higher for anyone whose contract started before 6/27.
5. Add a "paid" marker so `generateStorefrontStatements()` stops re-summing
   already-reported sales every time it runs - matters more now that full
   history is in play.
6. Everything else from HANDOFF_1 that's still open: deployment billing,
   SMTP verification, `ASANA_TOKEN` for standalone runs.

## Update (2026-08-07): full-history category audit re-run with Asana reconnected

Container reset since the last session - local db and prior `ASANA_TOKEN`
access were gone, but Asana got reconnected via this chat's MCP connector.
Re-ran the category-vs-Asana audit against **full order history** (36,440
orders, not just a July window) and fresh Asana data (84 tasks). Mapped
**Tania Hansen** (`THAN`) - her contract dates were filled in 8/4 and she has
real sales ("Than29 Jadeite" etc). Confirmed **Dana Smith and Hal Weber are
still missing contract dates** - not resolved despite earlier belief that
they were.

**Found a real code collision, not yet acted on - needs an owner decision:**
Two different people are both tagged `WOOD` in Clover. Greg Woods (already
mapped, real contract) has items like "Wood22 Drexel Dresser" - Sherri Wood
(brand new, category "WOOD SHERRI (WOOD)", no contract dates yet) has items
like "WOOD5 MISC". There's no code-level way to tell their sales apart.
Documented in `seed.js` as a comment; **do not map Sherri Wood under `WOOD`**
even once she has contract dates - she needs a distinct code going forward
(e.g. `SWOOD`), and someone should check whether her historical `WOOD...`
sales can be separated from Greg's by item-number range (his cluster in the
20s, hers in 1-5) before trusting any past total under this code.

**"Suans Harrison(SUHA)" is a non-issue** - just a typo'd Clover *category*
label (should be "Susan"). The actual item names are all tagged correctly
as `SUHA...`, so it already syncs fine under the existing Sue Harrison
mapping. Same situation as the earlier Rod Ruter false alarm.

**Correction to an earlier note:** the old "MOORE, JIM (JIMM) -> Reichel,
Jim (unconfirmed)" guess was wrong. There are two different Jims - Jim
Moore (already mapped as `JIMM`) and a separate, real Jim Reichel (category
"Reichel, Jim (JRei)", items tagged `Jrei...`/`JRei...`, `completed: true`,
due 2026-05-15) who was never mapped at all. He's in the "identified,
missing dates" list below.

### Identified in Asana, real Clover code found, blocked only on contract dates

All of these have a confirmed Asana task and a confirmed Clover code (from
real item names, not guessed) - the only blocker is `contract_start`/
`due_on` being empty in Asana. Split by whether the Asana task is currently
`completed: false` (likely still active - real, current money) or
`completed: true` (likely already settled before this system existed, per
the owner's standing rule - lower priority, but worth a sanity check on the
bigger dollar amounts).

**`completed: false` - active, no dates yet:**

| Category | Code | Full-history $ | Due on file |
|---|---|---|---|
| Smith, Dana (SD) | `SD` | $6,086.00 | none |
| WEBER, HAL | `WEBER` | $7,269.25 | 2026-09-01 |
| WOOD SHERRI (WOOD) | **collision - see above, do not map as `WOOD`** | $2,922.50 | none |

**`completed: true` - likely already settled, flagging the totals in case any should be double-checked:**

| Category | Code | Full-history $ | Due on file |
|---|---|---|---|
| THOMPSON, DAVE (DT) | `DT` | $77,664.51 | 2026-06-15 |
| BRENNAN, MIA (MIA) | `MIA` | $27,188.40 | 2026-01-30 |
| VENABLE, CAROL (VEN) | `VEN` | $23,109.65 | 2026-01-01 |
| POPE (Pope) | `POPE`/`Pope` | $21,601.54 | 2026-07-10 |
| HUBBLE, KATI (HUBB) | `HUBB` | $15,669.75 | 2026-07-20 |
| WOREK, MOLLY (MWOR) | `MWOR` | $14,911.50 | 2026-05-10 |
| HEATH, NANCY (HEA) | `HEA` | $14,872.10 | 2026-02-15 |
| Riccardelli (Ric) | `RIC` | $14,382.70 | 2026-02-01 |
| Meyer, Chazie (Chaz) | `CHAZ` | $12,526.00 | 2026-02-01 |
| LAND, Lorraine (Lland) | `LLAND` | $9,941.35 | 2026-07-01 |
| Farson, Janet (Fars) | `FARS` | $5,325.00 | 2026-01-01 |
| FILLER ESTATE (FIL) | `FIL` | $4,641.00 | 2026-05-10 |
| Marano, Marilyn (Mar) | `MAR` | $4,583.00 | 2026-04-25 |
| Johnson Trust (JTRUST) | `JTRUST` | $3,927.00 | 2026-03-01 |
| Turner Julie | `JTUR` (not "Turner"/"Julie" - confirm before mapping) | $3,330.82 | 2026-06-01 |
| NAGLE, HIROMI (NAG) | `NAG` | $2,719.00 | 2026-03-01 |
| BRUSS, TERRY (Bruss) | `BRUSS` | $2,372.00 | 2026-06-01 |
| Richy, Gwen (Rich) | `RICH` | $2,300.00 | 2026-05-15 |
| SEBRING, BRETT (BS) | `BS` | $2,099.00 | 2026-03-01 |
| Harper, Shawna (Harp) | `HARP` | $1,328.00 | 2026-05-15 |
| Reichel, Jim (JRei) | `JREI` | $558.00 | 2026-05-15 |
| CROWLEY, ATHENA (CROW) | `CROW` | $392.00 | 2026-03-15 |
| Turner, Wendy (Wturn) | `WTURN` | $155.00 | 2026-05-20 |

**Owner action needed:** fill in `contract_start` in Asana for all of the
above (especially the 3 `completed: false` ones - that's current, active
money). Once filled in, add each `{gid: code}` to `CODE_BY_TASK_GID` in
`seed.js` - the code is already confirmed from real Clover item names, no
further lookup needed.

### Not matched to any Asana task at all (45 categories, full history)

Real dollar amounts, but no Asana task name comes close by word-matching -
these are either people who were never entered as an Asana task, or
spelling is too different to match automatically. Code (from real item
names) shown so whoever identifies the person can go straight to adding a
task + code, no further digging needed. Sorted by dollar amount:

| Category | Code | Full-history $ |
|---|---|---|
| COTTINGHAM (TC) | `TC` | $42,946.00 |
| Harper Estate (MH) | `MH` | $40,894.95 |
| Hedi Munroe (Mun) | `MUN` | $26,907.24 |
| CLARK, MOLLIE (MC) | `MC` | $26,626.00 |
| Miller Judy | `JM` | $20,071.00 |
| ISENBERG, SARAH (ISEN) | `ISEN` | $16,084.35 |
| WEEKS, HENRY (HW) | `HW` | $14,631.07 |
| KNOX, CLORUS (Knox) | `KNOX` - **note: already-mapped `KNOX` is Cloris Knox, likely the same person, spelling drifted ("Clorus" vs "Cloris") - check before treating as separate** | $11,799.50 |
| VQMH2 | n/a | $11,473.00 |
| Haskel (Hask) | `HASK` | $11,421.00 |
| Grill, Beth (Grill) | `GRILL` | $10,387.00 |
| Ray, Jana (Ray) | `RAY` | $10,185.00 |
| GENTILMAN, PEBBLES (PEB) | `PEB` | $8,549.00 |
| Allen, Colleen (CA) | `CA` | $5,828.00 |
| Laycock (TL) | `TL` | $5,354.00 |
| FORCIER, VALERIE (VF) | `VF` | $5,316.00 |
| VMD2025 | `VMD` | $5,114.68 |
| Cammack (VC) | `VC` | $5,078.00 |
| Leach (RL) | `RL` | $5,010.00 |
| VM | `VM` | $4,910.89 |
| Rogers, Nicki (NR) | `NR` | $4,579.00 |
| VQ MH Pick | n/a | $4,414.00 |
| Helen Haause (Haau) | `HAAU` | $3,549.00 |
| GALLUP, TODD (TODD) | `TODD` | $3,346.00 |
| Eccles, Cheryl (Cecc) | `CECC` | $3,265.00 |
| Micah (Micah) | `MICAH` | $3,071.51 |
| Crouch, John (JC) | `JC` | $2,466.00 |
| Matthews, Diane (Matt) | `MATT` | $1,875.00 |
| CLEARANCE | n/a (looks like a house/register category, not a consignor) | $1,831.00 |
| Roberts, Heidi (HR) | `HR` | $1,796.00 |
| Knickbocker (Knic) | `KNIC` | $1,666.00 |
| Sullivan (LS) | `LS` | $1,360.00 |
| Finn, Elizabeth (Finn) | `FINN` | $1,292.00 |
| SIMON, CHRIS (SIMON) | `SIMON` | $1,274.00 |
| Philbrook Marsha (MP) | `MP` | $1,141.76 |
| Martinez, Martin (MaMa) | `MM` (not "MaMa" as the category suggests) | $650.00 |
| Loepp (BL) | `BL` | $545.00 |
| McMinn, Joy (Mcm) | `MCM` | $451.00 |
| Gieselman, Jan (Gies) | `GIES` | $350.00 |
| Walker, Gayle (Wal) | `WAL` | $321.00 |
| Larry Roberts (Rob) | `ROB` | $145.00 |
| Scott Bennett (Benn) | `BENN` - **note: this looks like it could be the already-mapped `BENN` (Scott Bennet, one T) - check for a duplicate Asana task before treating as a new person** | $143.00 |
| Lane, Nicole (Lane) | `LANE` | $90.00 |

`VQMH2`, `VQ MH Pick`, and `CLEARANCE` don't look like consignor names at
all - probably internal/house categories (similar to the already-excluded
`IETS`/`9000` house stock). Worth a quick owner confirmation rather than
chasing them as missing people.

**Two likely duplicates worth checking before creating new Asana tasks:**
`KNOX, CLORUS` (unmatched, $11,799.50) is probably the same person as the
already-mapped `Cloris Knox` (code `KNOX`) - spelling drifted. `Scott
Bennett` (unmatched, $143.00) is probably the same person as already-mapped
`Scott Bennet` (code `BENN`) - one-T/two-T spelling. If confirmed, these
just need the existing code applied in Clover going forward, not a new
consignor entry.

Raw audit script + full JSON output saved in this session's scratchpad for
reference if needed again:
`/tmp/claude-0/-home-user-Client-database-/55b0a2cb-ff5f-5fa4-9e93-94aff7e97503/scratchpad/audit.mjs`
and `audit_result.json` (not committed - scratch only).
