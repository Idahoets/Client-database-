# Vintage Queen backend

Connected to the real Clover account and tested against live inventory/order
data. Parsing (`sync.js`) and estate-sale detection (`clover.js`) are now
based on what the account actually contains, not guesses - see below for what
that turned out to be and what's still open.

## What's here

- `src/db.js` - SQLite schema: consignors, items, sync bookkeeping, generated reports
- `src/clover.js` - Clover REST API client (items, orders)
- `src/sync.js` - matches Clover order line items back to consignors by SKU, updates statuses
- `src/reports.js` - the two payout jobs: estate payout (7 days after each estate sale), storefront statement (monthly, payable at 90-day contract end)
- `src/server.js` - small API the portal reads from
- `src/seed.js` - add your real consignors here

## What real Clover data looks like here

- The consignor code isn't a separate SKU field (that field is empty on every
  item) - it's embedded directly in the item/line-item **name**, e.g.
  `"Smc116 Vtg Collins Homestead Axe"` or, on some of Sue Daniel's furniture,
  at the end instead: `"Glass/wood Coffe Table Sdan104"`. Codes vary in
  length and casing (`BB`, `Smc`, `PRICE`, `Bruss`...), so `sync.js` now
  matches against the **known consignors table** rather than a fixed regex -
  seed real consignors before running sync, or those lines are left unmatched.
- `"9000"` is the shop's own house stock, not a consignor - always skipped.
- 29 real consignor code -> name pairs were readable straight from Clover's
  own item categories. Ask Claude Code to list them if you want to seed
  `seed.js` from that instead of typing codes by hand - it still needs `type`,
  `contract_start`, and (for estate clients) `estate_sale_date` from you,
  which aren't in Clover anywhere.

## Still open

1. **Confirm the estate-sale devices.** `isEstateSaleOrder()` now reads
   `ESTATE_SALE_DEVICE_IDS` from `.env` (comma-separated, empty = everything
   counts as storefront). Real order history shows the storefront register in
   use almost every business day, and two other devices that each only appear
   for a single estate-sale day/weekend - see `.env.example` for those two
   candidate ids and which sale each is likely tied to. This directly sets
   the commission rate (40% vs 50%) and payout timing, so don't set it until
   you've confirmed which sale(s) they were.
2. **No item-import step yet.** Regular (non-misc) sold items are matched by
   `consignor_code + sku` against rows already in the `items` table, but
   nothing currently populates that table from Clover inventory - only the
   misc-lot buckets get created automatically during sync. Worth deciding
   whether items get imported from Clover directly (matching the same
   code-first/code-last parsing) or entered some other way.
3. **Decide how statements actually reach consignors** - email, text, printed,
   posted in the portal only, etc. `reports.js` has a TODO right where that
   hooks in.

## Running it (once .env is filled in)

```bash
npm install
cp .env.example .env   # then fill in your real Clover credentials
npm run sync            # pulls recent Clover orders and updates the database
npm start                # starts the API + the two scheduled report jobs
```
