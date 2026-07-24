import cron from 'node-cron';
import db from './db.js';
import { newApprovalToken, sendReviewEmail, sendMonthlyDigestEmail, sendNeedsManualOutreachEmail } from './notify.js';

const COMMISSION = { estate_sale: 0.40, storefront: 0.50 };
const ESTATE_PAYOUT_DAYS = 7;

// Nothing goes to a consignor automatically - every report gets queued for
// review (email to accounting@idahoets.com with an approve link) rather than
// sent directly. Only reports with something actually owed are worth a
// review email; $0/not-yet-payable reports still get recorded for history.
// No text messages (owner decision) - a consignor with no email on file has
// no automated delivery method, and is flagged for manual outreach instead.
function deliveryFor(consignor) {
  return consignor.contact_email
    ? { delivery_method: 'email', recipient: consignor.contact_email }
    : { delivery_method: null, recipient: null };
}

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
export async function generateEstatePayoutReports() {
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
    const details = JSON.stringify({ estate_sale_date: c.estate_sale_date, item_count: items.length });

    if (total <= 0) {
      db.prepare(`INSERT INTO reports (consignor_code, report_type, amount, details_json) VALUES (?, 'estate_payout', ?, ?)`)
        .run(c.code, total, details);
      console.log(`Estate payout for ${c.name} (${c.code}): $0.00 - nothing owed, not sent for review.`);
      continue;
    }

    const { delivery_method, recipient } = deliveryFor(c);

    if (!delivery_method) {
      db.prepare(`INSERT INTO reports (consignor_code, report_type, amount, details_json) VALUES (?, 'estate_payout', ?, ?)`)
        .run(c.code, total, details);
      await sendNeedsManualOutreachEmail(c, 'estate_payout', total);
      console.log(`Estate payout ready for ${c.name} (${c.code}): $${total.toFixed(2)} - no email on file, flagged for manual outreach.`);
      continue;
    }

    const token = newApprovalToken();
    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO reports (consignor_code, report_type, amount, details_json, delivery_method, recipient, approval_token)
      VALUES (?, 'estate_payout', ?, ?, ?, ?, ?)
    `).run(c.code, total, details, delivery_method, recipient, token);

    const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id);
    await sendReviewEmail(report, c);

    console.log(`Estate payout ready for ${c.name} (${c.code}): $${total.toFixed(2)} - review sent to accounting@idahoets.com`);
  }
}

// Storefront statement: everything sold in-store, generated monthly, but only
// actually payable once the consignor's contract has ended (contract_end is
// the real date from Asana - it isn't reliably contract_start + 90 days).
// One digest review email covers the whole run (see notify.js) rather than
// one email per consignor.
export async function generateStorefrontStatements() {
  const consignors = db.prepare(`SELECT * FROM consignors`).all();
  const batchToken = newApprovalToken();
  const forDigest = [];
  const needsManual = [];
  const consignorsByCode = {};

  for (const c of consignors) {
    const items = db.prepare(`
      SELECT * FROM items WHERE consignor_code = ? AND channel = 'storefront' AND status = 'sold_store'
    `).all(c.code);

    const total = items.reduce((sum, i) => sum + payoutFor(i), 0);
    const ready = new Date() >= new Date(c.contract_end + 'T00:00:00');
    const details = JSON.stringify({ contract_end: c.contract_end, payable: ready, item_count: items.length });

    if (total <= 0) {
      db.prepare(`INSERT INTO reports (consignor_code, report_type, amount, details_json) VALUES (?, 'storefront_statement', ?, ?)`)
        .run(c.code, total, details);
      continue;
    }

    const { delivery_method, recipient } = deliveryFor(c);

    if (!delivery_method) {
      db.prepare(`INSERT INTO reports (consignor_code, report_type, amount, details_json) VALUES (?, 'storefront_statement', ?, ?)`)
        .run(c.code, total, details);
      needsManual.push({ consignor: c, amount: total });
      console.log(`Storefront statement for ${c.name} (${c.code}): $${total.toFixed(2)} - no email on file, flagged for manual outreach.`);
      continue;
    }

    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO reports (consignor_code, report_type, amount, details_json, delivery_method, recipient, approval_token)
      VALUES (?, 'storefront_statement', ?, ?, ?, ?, ?)
    `).run(c.code, total, details, delivery_method, recipient, batchToken);

    forDigest.push(db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id));
    consignorsByCode[c.code] = c;

    console.log(`Storefront statement for ${c.name} (${c.code}): $${total.toFixed(2)} - ${ready ? 'payable now' : 'accruing'}`);
  }

  if (forDigest.length || needsManual.length) {
    await sendMonthlyDigestEmail(forDigest, consignorsByCode, needsManual);
    console.log(`Monthly digest sent to accounting@idahoets.com: ${forDigest.length} ready to approve, ${needsManual.length} need manual outreach.`);
  }
}

// Schedule: check for estate payouts daily, generate storefront statements monthly.
export function startScheduledJobs() {
  cron.schedule('0 8 * * *', () => generateEstatePayoutReports().catch(err => console.error('Estate payout job failed:', err.message)));
  cron.schedule('0 8 1 * *', () => generateStorefrontStatements().catch(err => console.error('Storefront statement job failed:', err.message)));
  console.log('Scheduled jobs registered: daily estate payout check, monthly storefront statement.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.resolve()
    .then(() => generateEstatePayoutReports())
    .then(() => generateStorefrontStatements())
    .catch(err => {
      console.error('Reports run failed:', err.message);
      process.exit(1);
    });
}
