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
- `src/sync.js` - matches Clover order line items back to consignors by SKU, updates statuses
- `src/reports.js` - the two payout jobs: estate payout (7 days after each estate sale), storefront statement (monthly, payable at real contract end)
- `src/server.js` - small API the portal reads from
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
item names. Currently mapped: 14 consignors. Tasks missing `contract_start`
or `due_on` are skipped rather than guessed (mostly historical/completed
tasks that predate these fields being tracked).

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

## Still open

1. **No item-import step yet.** Regular (non-misc) sold items are matched by
   `consignor_code + sku` against rows already in the `items` table, but
   nothing currently populates that table from Clover inventory - only the
   misc-lot buckets get created automatically during sync. Worth deciding
   whether items get imported from Clover directly (matching the same
   code-first/code-last parsing) or entered some other way.
2. **Decide how statements actually reach consignors** - email, text, printed,
   posted in the portal only, etc. `reports.js` now includes each consignor's
   email (from Asana) in the report record, so the data's there - `reports.js`
   still has a TODO right where the actual send hooks in.

## Running it (once .env is filled in)

```bash
npm install
cp .env.example .env   # then fill in your real Clover + Asana credentials
npm run seed            # pulls consignors from Asana
npm run sync             # pulls recent Clover orders and updates the database
npm start                # starts the API + the two scheduled report jobs
```
