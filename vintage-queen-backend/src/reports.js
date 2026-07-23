import cron from 'node-cron';
import db from './db.js';

const COMMISSION = { estate_sale: 0.40, storefront: 0.50 };
const ESTATE_PAYOUT_DAYS = 7;
const CONTRACT_DAYS = 90;

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d;
}

function payoutFor(item) {
  const commission = COMMISSION[item.channel];
  const gross = item.is_misc ? item.tag_price * item.qty : item.sold_price;
  return gross * (1 - commission);
}

// Estate sale payout: only items sold at the estate sale, due 7 days after that sale.
// Run daily - fires once per consignor per estate sale, right on the due date.
export function generateEstatePayoutReports() {
  const today = new Date().toISOString().slice(0, 10);

  const estateClients = db.prepare(`
    SELECT * FROM consignors WHERE type = 'estate' AND estate_sale_date IS NOT NULL
  `).all();

  for (const c of estateClients) {
    const dueDate = addDays(c.estate_sale_date, ESTATE_PAYOUT_DAYS).toISOString().slice(0, 10);
    if (dueDate !== today) continue;

    const alreadySent = db.prepare(`
      SELECT 1 FROM reports WHERE consignor_code = ? AND report_type = 'estate_payout'
        AND details_json LIKE ?
    `).get(c.code, `%${c.estate_sale_date}%`);
    if (alreadySent) continue;

    const items = db.prepare(`
      SELECT * FROM items WHERE consignor_code = ? AND channel = 'estate_sale' AND status = 'sold_estate'
    `).all(c.code);

    const total = items.reduce((sum, i) => sum + payoutFor(i), 0);

    db.prepare(`
      INSERT INTO reports (consignor_code, report_type, amount, details_json)
      VALUES (?, 'estate_payout', ?, ?)
    `).run(c.code, total, JSON.stringify({ estate_sale_date: c.estate_sale_date, item_count: items.length }));

    console.log(`Estate payout ready for ${c.name} (${c.code}): $${total.toFixed(2)}`);
    // TODO: hook up email/notification here once you decide how statements go out
  }
}

// Storefront statement: everything sold in-store, generated monthly, but only
// actually payable once the consignor's 90-day contract has ended.
export function generateStorefrontStatements() {
  const consignors = db.prepare(`SELECT * FROM consignors`).all();

  for (const c of consignors) {
    const contractEnd = addDays(c.contract_start, CONTRACT_DAYS);
    const items = db.prepare(`
      SELECT * FROM items WHERE consignor_code = ? AND channel = 'storefront' AND status = 'sold_store'
    `).all(c.code);

    const total = items.reduce((sum, i) => sum + payoutFor(i), 0);
    const ready = new Date() >= contractEnd;

    db.prepare(`
      INSERT INTO reports (consignor_code, report_type, amount, details_json)
      VALUES (?, 'storefront_statement', ?, ?)
    `).run(c.code, total, JSON.stringify({
      contract_end: contractEnd.toISOString().slice(0, 10),
      payable: ready,
      item_count: items.length
    }));

    console.log(`Storefront statement for ${c.name} (${c.code}): $${total.toFixed(2)} - ${ready ? 'payable now' : 'accruing'}`);
  }
}

// Schedule: check for estate payouts daily, generate storefront statements monthly.
export function startScheduledJobs() {
  cron.schedule('0 8 * * *', generateEstatePayoutReports);     // every day at 8am
  cron.schedule('0 8 1 * *', generateStorefrontStatements);    // 1st of every month at 8am
  console.log('Scheduled jobs registered: daily estate payout check, monthly storefront statement.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateEstatePayoutReports();
  generateStorefrontStatements();
}
