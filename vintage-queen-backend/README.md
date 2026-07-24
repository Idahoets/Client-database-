# Vintage Queen backend

Connected to the real Clover account and Asana project, tested end-to-end
against live data. Parsing (`sync.js`), channel classification (`clover.js`),
and consignor seeding (`seed.js` + `asana.js`) are all based on what the
accounts actually contain, not guesses - see below for what that turned out
to be and what's still open.

## What's here

- `src/db.js` - SQLite schema: consignors, items, sync bookkeeping, generated reports
- `src/clover.js` - Clover REST API client (items, orders, order channel classification)
- `src/asana.js` - Asana API client, reads the Client Database project as consignor records
- `src/skuParser.js` - shared consignor-code matching, used by both `items.js` and `sync.js`
- `src/items.js` - imports current Clover inventory (regular items only) into the `items` table
- `src/sync.js` - matches Clover order line items back to consignors by SKU, updates statuses
- `src/reports.js` - the two payout jobs: estate payout (7 days after each estate sale), storefront statement (monthly, payable at real contract end)
- `src/notify.js` - builds and sends the review/digest/consignor/manual-outreach emails (Outlook SMTP) - no text messages, per owner decision
- `src/server.js` - small API the portal reads from, plus the approve-link endpoints
- `src/seed.js` - pulls consignors from Asana, joins in the Clover code (see below), upserts into the `consignors` table

## What real Clover data looks like here

- The consignor code isn't a separate SKU field (that field is empty on every
  item) - it's embedded directly in the item/line-item **name**, e.g.
  `"Smc116 Vtg Collins Homestead Axe"` or, on some of Sue Daniel's furniture,
  at the end instead: `"Glass/wood Coffe Table Sdan104"`. Codes vary in
  length and casing (`BB`, `Smc`, `PRICE`, `Bruss`...), so `sync.js` matches
  against the **known consignors table** rather than a fixed regex - seed
  real consignors before running sync, or those lines are left unmatched.
- `"9000"` is the shop's own house stock, not a consignor - always skipped.
- Order channel is now three-way, via device id (`classifyOrderChannel` in
  `clover.js`): `ESTATE_SALE_DEVICE_IDS` (confirmed: Sue Daniel's estate sale,
  6/26-6/27), `EXCLUDED_DEVICE_IDS` (confirmed: the 7/11 warehouse sale - same
  checkout style by coincidence, not consignor business, skipped entirely,
  not attributed to anyone), everything else is storefront.
- `contract_end` is a real stored date (from Asana's task `due_on`), not
  computed as `contract_start + 90 days` - checked against real data and the
  gap isn't a flat 90 days for every consignor (e.g. Sue Daniel: 116 days).

## Consignor data lives in Asana, not a manual spreadsheet

`seed.js` pulls the **Client Database** Asana project (`ASANA_PROJECT_ID`) via
`src/asana.js` and maps each task to a consignor: name, type (inferred from
whether "Estate Sale Dates" is filled in), `contract_start`, `contract_end`
(the task's `due_on`), `estate_sale_date` (the later date in the "Estate Sale
Dates" free-text range, e.g. "6/26-6/27"), and email.

Asana has no concept of the Clover code, so that's maintained by hand in
`CODE_BY_TASK_GID` in `seed.js`, cross-checked against real Clover category/
item names where possible, owner-confirmed otherwise. Currently mapped: 23 of
25 active consignors. Tasks missing `contract_start` or `due_on` are skipped
rather than guessed (mostly historical/completed tasks that predate these
fields being tracked).

Asana cleanup done (owner-confirmed): renamed the "Bob Hendry" task to "Ben
Hendry" (typo), deleted the stale/empty "Harrison, Sue" duplicate (kept "Sue
harrison", which has the real contract/contact data), and deleted one of the
two identical "Carbondale Estate Sale" tasks. All three verified to have no
notes/attachments/subtasks before deleting anything.

**Needs input before seeding is complete:**
- 9 more mapped by the owner, none yet visible in the Clover data pulled here
  (`getItems()` only fetches the most recent 1000 items, no pagination):
  Tucker Wardwell (`TUCK`), +Anothony/Cindy Maher (`MAHER`), Smith Estate/
  Roxanne (`ROX`), Cloris Knox (`KNOX`), Emily Chamberlin (`CHAMB`), Steve
  Dobbs (`DOBB`), Steve Money (`MONEY`), Lisa Peterson (`PETE`), Sue Harrison
  (`SUHA` - confirmed a different person from Sue Daniel/`SDAN`, an earlier
  given code for her was wrong and not applied).
- Mitzi Jenson and Patrick Connor: confirmed no Clover category exists for
  them yet (owner-confirmed) - nothing to map until one does.

## Item import (`items.js`)

Regular (non-misc) items need a row in `items` before `sync.js` can match a
sale back to one - `npm run import-items` pulls current Clover inventory and
creates those rows, using the same code-first/code-last parsing as sync (via
the shared `skuParser.js`). Misc lots are intentionally *not* pre-listed -
they have no individual identity in Clover until sold, so `sync.js` still
creates/bumps their bucket row reactively, same as before.

Channel/status at listing time defaults from the consignor's `type` (estate
-> `estate_listed`/`estate_sale`, direct -> `in_stock`/`storefront`) - this is
just a best-effort starting point, since `sync.js` now corrects both
`status` and `channel` to match the actual sale once an item sells (see
below), regardless of how it was originally listed.

Found and fixed two related bugs while building this, both real correctness
issues verified against live data:
- The regular-item `UPDATE` in `sync.js` only ever set `status`, never
  `channel`. An estate consignor's leftover item that doesn't sell at the
  estate sale and later sells at the storefront would end up with
  `status='sold_store'` but `channel` stuck at `'estate_sale'` from listing -
  matching neither payout report's `WHERE channel = ... AND status = ...`
  filter, so the sale would silently vanish from both. Confirmed this
  actually happens: several of Sue Daniel's items sold weeks after her
  estate sale weekend. `sync.js` now sets `channel` from the sale's actual
  order, not just `status`.
- Regular items are now matched primarily by Clover's own item id (stable
  even if the tag text is edited later), falling back to `consignor_code +
  sku` text only for anything sold before it was ever imported.

## Statement delivery - nothing goes to a consignor without approval

Every report (estate payout or storefront statement) is queued for review,
never sent directly:

1. When a report is generated with something actually owed (>$0), it's
   emailed to `ACCOUNTING_EMAIL` (accounting@idahoets.com) with the exact
   drafted message and a one-click **approve** link.
2. Estate payouts (rare, one consignor at a time as each comes due) get their
   own review email. Storefront statements (up to ~20 consignors at once,
   monthly) get **one digest email** instead of one per consignor - a table
   of every consignor/amount, an individual approve link for each, and one
   "approve ALL" link for the whole batch.
3. Nothing reaches the consignor until a link is clicked. Clicking hits
   `GET /api/reports/:id/approve/:token` (or `/api/reports/batch/:token/approve`
   for the whole batch), which sends the real message and marks the report
   `sent`. A failed send (e.g. SMTP not configured) leaves it `pending_review`
   so it can be retried by clicking again.
4. **No text messages** (owner decision) - email is the only automated
   channel. A consignor with no email on file gets flagged in its own section
   of the review/digest email ("needs manual outreach") with their phone
   number if there is one, instead of a broken send attempt. Currently 6 of
   the 23 mapped consignors have no email and fall into this bucket.
5. $0 / not-yet-payable reports are still recorded in the `reports` table for
   history, but skip the review email entirely - nothing to approve.

`SMTP_USER`/`SMTP_PASSWORD` are set (Outlook, accounting@idahoets.com) but
**unverified** - this sandbox only allows outbound HTTPS, so a raw SMTP
connection on port 587 times out here regardless of whether the credentials
are actually correct. Until this runs somewhere with normal network access,
sends are logged ("would have emailed...") instead of going out - nothing is
silently lost, but nothing real has gone out yet either.

**Needs your input:**
- Somewhere to actually deploy this app - required both to verify/use the
  SMTP credentials and to make approve links clickable from anywhere but
  this machine.

## Deployment (Render)

Right now this only runs inside a Claude Code session - there's no server
that stays up once the session ends, which is why none of the approve links
or emails can actually work yet. Picked **Render** to host it: simplest
deploy flow of the common options (connect the GitHub repo, it builds and
runs automatically from `render.yaml` at the repo root).

**Use the Starter plan, not Free** - this isn't optional for this app:
- Render's free tier has no persistent disk at all, so the SQLite database
  would be wiped on every deploy/restart.
- Free web services sleep after 15 minutes idle. The scheduled jobs (daily
  estate-payout check, monthly storefront statements) only fire if the
  process is actually running at 8am - if it's asleep, that day's reports
  just don't get generated, with nothing to signal it.

Starter is ~$7/month and avoids both problems (always-on, persistent disk).

**To deploy** (needs your Render account + billing - not something that can
be done from here):
1. Sign up / log in at render.com, connect your GitHub account, and give it
   access to this repo (`Idahoets/Client-database-`).
2. New -> Blueprint -> select this repo. Render reads `render.yaml`
   automatically (it points at the `vintage-queen-backend` subfolder and
   requests the Starter plan + a 1GB persistent disk mounted at `/data`).
3. Render will prompt for the env vars marked `sync: false` in `render.yaml`
   - fill these in from your local `.env`: `CLOVER_MERCHANT_ID`,
   `CLOVER_ACCESS_TOKEN`, `ESTATE_SALE_DEVICE_IDS`, `EXCLUDED_DEVICE_IDS`,
   `ASANA_PROJECT_ID`, `ASANA_TOKEN` (once you have one), `SMTP_USER`,
   `SMTP_PASSWORD`.
4. Deploy. `PUBLIC_BASE_URL` doesn't need to be set manually - `notify.js`
   picks up Render's own `RENDER_EXTERNAL_URL` automatically, so approve
   links work right away.
5. Once it's live, run `npm run seed`, `npm run import-items`, and
   `npm run sync` against it (via Render's shell, or point a local run at
   the same database) to populate real data - a fresh deploy starts empty.

## Running it (once .env is filled in)

```bash
npm install
cp .env.example .env   # then fill in your real Clover + Asana credentials
npm run seed            # pulls consignors from Asana
npm run import-items     # pulls current Clover inventory into the items table
npm run sync              # pulls recent Clover orders and updates the database
npm start                 # starts the API + the two scheduled report jobs
```
