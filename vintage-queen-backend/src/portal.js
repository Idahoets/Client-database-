import express from 'express';
import crypto from 'crypto';
import db from './db.js';
import { getDashboardData } from './payout.js';

const SESSION_DAYS = 30;

// Every consignor needs a PIN before they can log in - generated once and
// never touched again by re-seeding (seed.js's upsert doesn't reference this
// column at all), so a consignor's login never changes underneath them.
// Returns the full consignor rows that just got a new PIN, so the caller can
// let them know how to log in.
export function ensurePortalPins() {
  const missing = db.prepare(`SELECT * FROM consignors WHERE portal_pin IS NULL`).all();
  const setPin = db.prepare(`UPDATE consignors SET portal_pin = ? WHERE code = ?`);
  for (const c of missing) {
    c.portal_pin = String(crypto.randomInt(100000, 1000000)); // always 6 digits
    setPin.run(c.portal_pin, c.code);
  }
  return missing;
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

const COOKIE_NAME = 'vq_portal_session';

// Cleans out expired sessions lazily on each check rather than running a
// separate scheduled job - cheap at this scale (dozens of consignors).
export function requirePortalSession(req, res, next) {
  db.prepare(`DELETE FROM portal_sessions WHERE expires_at < datetime('now')`).run();

  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const session = token && db.prepare(`SELECT * FROM portal_sessions WHERE token = ?`).get(token);
  if (!session) {
    if (req.accepts('html')) return res.redirect('/portal/login');
    return res.status(401).json({ error: 'Not logged in' });
  }
  req.session = session;
  next();
}

const router = express.Router();

function page(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - The Vintage Queen Consignor Portal</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 16px; color: #222; }
  h1 { font-size: 1.4rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
  th { color: #666; font-weight: 600; }
  .summary { display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }
  .stat { background: #f5f5f5; border-radius: 8px; padding: 12px 16px; }
  .stat .num { font-size: 1.3rem; font-weight: 600; }
  .stat .label { font-size: 0.8rem; color: #666; }
  .sold { color: #1a7f37; }
  .available { color: #666; }
  input { padding: 8px; font-size: 1rem; margin: 4px 0 12px; width: 100%; box-sizing: border-box; }
  button { padding: 8px 16px; font-size: 1rem; cursor: pointer; }
  .error { color: #c0392b; }
  form { max-width: 300px; }
</style></head><body>${body}</body></html>`;
}

router.get('/login', (req, res) => {
  res.send(page('Log in', `
    <h1>The Vintage Queen - Consignor Portal</h1>
    ${req.query.error ? `<p class="error">${req.query.error}</p>` : ''}
    <form method="post" action="/portal/login">
      <label>Consignor code<input name="code" required autofocus></label>
      <label>PIN<input name="pin" required inputmode="numeric" pattern="[0-9]*"></label>
      <button type="submit">Log in</button>
    </form>
  `));
});

router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  const pin = (req.body.pin || '').trim();
  const consignor = db.prepare(`SELECT code, portal_pin FROM consignors WHERE code = ?`).get(code);

  // Same generic error either way - don't reveal whether a code exists.
  if (!consignor || !consignor.portal_pin || consignor.portal_pin !== pin) {
    return res.redirect('/portal/login?error=' + encodeURIComponent('Incorrect code or PIN.'));
  }

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO portal_sessions (token, consignor_code, expires_at) VALUES (?, ?, ?)`).run(token, consignor.code, expiresAt);

  res.cookie(COOKIE_NAME, token, { httpOnly: true, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.redirect('/portal/dashboard');
});

router.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) db.prepare(`DELETE FROM portal_sessions WHERE token = ?`).run(token);
  res.clearCookie(COOKIE_NAME);
  res.redirect('/portal/login');
});

router.get('/dashboard', requirePortalSession, (req, res) => {
  const { consignor, items, summary } = getDashboardData(req.session.consignor_code);

  const rows = items.map(i => {
    const isSold = i.status === 'sold_estate' || i.status === 'sold_store';
    return `<tr>
      <td>${escapeHtml(i.title)}</td>
      <td>${escapeHtml(i.category || '')}</td>
      <td>$${i.tag_price.toFixed(2)}</td>
      <td class="${isSold ? 'sold' : 'available'}">${isSold ? `Sold ${i.sold_date || ''}` : 'Available'}</td>
    </tr>`;
  }).join('');

  res.send(page('Dashboard', `
    <h1>Hi ${escapeHtml(consignor.name)}</h1>
    <div class="summary">
      <div class="stat"><div class="num">${summary.activeCount}</div><div class="label">Available now</div></div>
      <div class="stat"><div class="num">${summary.soldCount}</div><div class="label">Sold total</div></div>
      <div class="stat"><div class="num">$${summary.owedTotal.toFixed(2)}</div><div class="label">Currently owed</div></div>
    </div>
    <form method="post" action="/portal/logout"><button type="submit">Log out</button></form>
    <table>
      <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No items yet.</td></tr>'}</tbody>
    </table>
  `));
});

router.get('/', (req, res) => res.redirect('/portal/dashboard'));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default router;
