import express from 'express';
import 'dotenv/config';
import db from './db.js';
import { startScheduledJobs } from './reports.js';
import { sendConsignorEmail } from './notify.js';
import { getDashboardData } from './payout.js';
import portalRouter, { requirePortalSession } from './portal.js';

const app = express();
app.use(express.json());
app.use('/portal', portalRouter);

// Nothing reaches a consignor except through here - hit by the approve
// link(s) in the review email accounting@idahoets.com gets for every report.
async function sendReport(report, consignor) {
  await sendConsignorEmail(report, consignor);
  db.prepare(`UPDATE reports SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`).run(report.id);
}

app.get('/api/reports/:id/approve/:token', async (req, res) => {
  const report = db.prepare(`SELECT * FROM reports WHERE id = ?`).get(req.params.id);
  if (!report || report.approval_token !== req.params.token) {
    return res.status(404).send('Report not found, or this link is no longer valid.');
  }
  if (report.status === 'sent') {
    return res.send(`Already sent to ${report.recipient} on ${report.sent_at}. No action taken.`);
  }

  const consignor = db.prepare(`SELECT * FROM consignors WHERE code = ?`).get(report.consignor_code);
  try {
    await sendReport(report, consignor);
    res.send(`Sent to ${consignor.name} (${report.recipient}).`);
  } catch (err) {
    res.status(500).send(`Not sent: ${err.message}`);
  }
});

// Approves every pending report from one monthly storefront-statement run in
// one click (they share a batch token - see reports.js).
app.get('/api/reports/batch/:token/approve', async (req, res) => {
  const reports = db.prepare(`SELECT * FROM reports WHERE approval_token = ? AND status = 'pending_review'`).all(req.params.token);
  if (!reports.length) {
    return res.send('No pending reports for this batch - already sent, or the link is no longer valid.');
  }

  const results = [];
  for (const report of reports) {
    const consignor = db.prepare(`SELECT * FROM consignors WHERE code = ?`).get(report.consignor_code);
    try {
      await sendReport(report, consignor);
      results.push(`OK: ${consignor.name} (${report.recipient})`);
    } catch (err) {
      results.push(`FAILED: ${consignor.name} - ${err.message}`);
    }
  }
  res.type('text/plain').send(results.join('\n'));
});

// Everything a consignor sees in their portal, in one call. Requires a
// logged-in session for that exact consignor - see portal.js. Without this,
// anyone who knew or guessed a consignor's code could see another
// consignor's private sales/financial data.
app.get('/api/consignors/:code/dashboard', requirePortalSession, (req, res) => {
  if (req.session.consignor_code !== req.params.code) {
    return res.status(403).json({ error: 'Not authorized for this consignor' });
  }
  const data = getDashboardData(req.params.code);
  if (!data) return res.status(404).json({ error: 'Consignor not found' });
  res.json(data);
});

app.get('/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Vintage Queen backend running on port ${port}`);
  startScheduledJobs();
});
