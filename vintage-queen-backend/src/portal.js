import express from 'express';
import crypto from 'crypto';
import db from './db.js';
import { getDashboardData, COMMISSION } from './payout.js';

const SESSION_DAYS = 30;
const ESTATE_PAYOUT_DAYS = 7;

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n) { return '$' + Number(n).toFixed(2); }

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Visual language matched to vintagequeen.shop's live Wix site: a warm
// white/blush backdrop, deep maroon ink, rosewood accents (pulled straight
// from the site's own CSS - #330000 body text, #663D3D icon/accent color,
// #FFF2F2 blush highlight). Playfair Display italic stands in for the
// site's Adobe-only Didot headers; a light-weight sans stands in for its
// DIN Next / Proxima Nova body type.
function page(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - The Vintage Queen Consignor Portal</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,500;1,700&family=Poppins:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap');

:root{
  --white:#FFFFFF;
  --blush:#FFF2F2;
  --blush-line:#EBD3D3;
  --maroon:#330000;
  --rosewood:#663D3D;
  --rosewood-dark:#4A2B2B;
  --mauve:#997979;
  --slate:#5C5A4E;
}
*{box-sizing:border-box;}
body{margin:0;background:var(--white);color:var(--maroon);font-family:'Poppins', sans-serif;font-weight:300;min-height:100vh;}
.wrap{max-width:980px;margin:0 auto;padding:32px 20px 60px;}

.ledger{max-width:420px;margin:60px auto;background:var(--blush);border:1px solid var(--blush-line);border-radius:2px;padding:36px 32px;box-shadow:0 12px 30px rgba(51,0,0,0.12);}
.ledger h1{font-family:'Playfair Display', serif;font-style:italic;font-weight:600;font-size:32px;color:var(--maroon);margin:0 0 4px;text-align:center;letter-spacing:0.3px;}
.ledger .sub{text-align:center;font-size:13px;color:var(--rosewood);opacity:0.85;margin:0 0 26px;letter-spacing:1.5px;text-transform:uppercase;}
.ledger label{display:block;font-size:13px;margin-bottom:6px;color:var(--rosewood);letter-spacing:0.3px;}
.ledger input{width:100%;padding:10px;font-family:'Space Mono',monospace;font-size:14px;border:1px solid var(--blush-line);background:#fff;border-radius:2px;margin-bottom:20px;color:var(--maroon);}
.ledger button{width:100%;padding:12px;background:var(--rosewood);color:var(--white);border:none;border-radius:2px;font-family:'Poppins',sans-serif;font-weight:500;font-size:14px;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;}
.ledger button:hover{background:var(--rosewood-dark);}
.ledger .error{color:var(--maroon);font-size:13px;text-align:center;margin:-10px 0 16px;}

.topbar{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;padding-bottom:18px;border-bottom:1px solid var(--blush-line);}
.brand{font-family:'Playfair Display',serif;font-style:italic;font-weight:600;color:var(--maroon);font-size:28px;letter-spacing:0.3px;}
.brand span{color:var(--rosewood);}
.who{color:var(--rosewood);opacity:0.9;font-size:14px;}
.who button{margin-left:12px;background:none;border:1px solid var(--rosewood);color:var(--rosewood);padding:4px 10px;border-radius:2px;cursor:pointer;font-family:'Poppins',sans-serif;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;}
.subline{color:var(--slate);font-size:13px;margin:18px 0 8px;letter-spacing:0.3px;}
.pathbadge{display:inline-block;margin-bottom:24px;font-family:'Poppins',sans-serif;font-weight:500;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--white);background:var(--rosewood);padding:5px 12px;border-radius:20px;}

.payoutbar{background:var(--blush);border:1px solid var(--blush-line);border-radius:3px;padding:14px 18px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;font-family:'Poppins',sans-serif;font-size:13px;color:var(--maroon);}
#payoutBars{margin-bottom:22px;}
.payoutbar .accrued{font-family:'Space Mono',monospace;font-size:16px;color:var(--maroon);font-weight:700;}
.payoutbar .status{font-size:11px;letter-spacing:0.5px;text-transform:uppercase;padding:4px 10px;border-radius:20px;background:var(--mauve);color:var(--white);}
.payoutbar .status.ready{background:var(--rosewood);}

.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:32px;}
.stat{background:var(--white);border:1px solid var(--blush-line);border-radius:3px;padding:14px 14px;}
.stat .label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--mauve);}
.stat .val{font-family:'Space Mono',monospace;font-size:20px;color:var(--maroon);margin-top:6px;}

.tabs{display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap;}
.tab{padding:6px 16px;border-radius:20px;border:1px solid var(--rosewood);color:var(--rosewood);background:transparent;font-family:'Poppins',sans-serif;font-size:12px;cursor:pointer;letter-spacing:0.5px;}
.tab.active{background:var(--rosewood);color:var(--white);font-weight:500;}

.board{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:26px 20px;}
.tag{position:relative;background:var(--white);border:1px solid var(--blush-line);border-radius:3px;padding:20px 16px 16px;box-shadow:0 6px 14px rgba(51,0,0,0.08);font-family:'Poppins',sans-serif;font-weight:300;}
.tag:nth-child(4n+1){transform:rotate(-1.6deg);}
.tag:nth-child(4n+2){transform:rotate(1.2deg);}
.tag:nth-child(4n+3){transform:rotate(-0.6deg);}
.tag:nth-child(4n+4){transform:rotate(2deg);}
.hole{position:absolute;top:-8px;left:50%;transform:translateX(-50%);width:16px;height:16px;border-radius:50%;background:var(--rosewood);border:2px solid var(--blush);}
.string{position:absolute;top:-26px;left:50%;transform:translateX(-50%);width:2px;height:20px;background:var(--mauve);}
.cat{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--rosewood);opacity:0.9;}
.channel{font-size:10px;letter-spacing:0.5px;text-transform:uppercase;color:var(--slate);margin-top:2px;}
.title{font-family:'Playfair Display',serif;font-style:italic;font-size:19px;font-weight:600;margin:4px 0 10px;line-height:1.25;color:var(--maroon);}
.priceline{display:flex;justify-content:space-between;align-items:baseline;font-family:'Space Mono',monospace;font-size:13px;border-top:1px dashed var(--blush-line);padding-top:10px;}
.tagprice.struck{text-decoration:line-through;opacity:0.5;}
.soldrow{margin-top:8px;font-family:'Space Mono',monospace;font-size:12px;color:var(--slate);}
.payout{color:var(--maroon);font-weight:700;}

.stamp{position:absolute;top:8px;right:8px;border:2px solid var(--maroon);color:var(--maroon);font-family:'Playfair Display',serif;font-style:italic;font-weight:600;font-size:12px;letter-spacing:1px;padding:2px 6px;border-radius:4px;transform:rotate(-14deg);opacity:0.85;mix-blend-mode:multiply;text-align:center;line-height:1.1;}

.hidden{display:none;}
.empty{color:var(--mauve);font-family:'Poppins',sans-serif;font-size:13px;}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

router.get('/login', (req, res) => {
  res.send(page('Sign in', `
    <div class="ledger">
      <h1>The Vintage Queen</h1>
      <p class="sub">Consignor ledger</p>
      ${req.query.error ? `<p class="error">${escapeHtml(req.query.error)}</p>` : ''}
      <form method="post" action="/portal/login">
        <label for="code">Consignor code</label>
        <input id="code" name="code" required autofocus autocomplete="off">
        <label for="pin">PIN</label>
        <input id="pin" name="pin" required inputmode="numeric" pattern="[0-9]*" autocomplete="off">
        <button type="submit">Open my ledger</button>
      </form>
    </div>
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

function isSold(i) { return i.status === 'sold_estate' || i.status === 'sold_store'; }
function isActive(i) { return i.status === 'estate_listed' || i.status === 'in_stock'; }

function channelLabel(channel) {
  const pct = Math.round(COMMISSION[channel] * 100);
  return channel === 'estate_sale' ? `estate sale · ${pct}% commission` : `storefront · ${pct}% commission`;
}

function itemCard(item, payoutFor) {
  const sold = isSold(item);
  const stampHtml = sold ? '<div class="stamp">sold</div>' : '';
  let bottomHtml = '';
  if (sold) {
    const where = item.status === 'sold_estate' ? 'estate sale' : 'store';
    bottomHtml = `<div class="soldrow">sold at ${where}, ${escapeHtml(item.sold_date || '')} · your payout <span class="payout">${fmt(payoutFor(item))}</span></div>`;
  }

  if (item.is_misc) {
    const total = item.tag_price * item.qty;
    return `<div class="tag" data-status="${sold ? 'sold' : 'active'}">
      <div class="string"></div><div class="hole"></div>
      ${stampHtml}
      <div class="cat">${escapeHtml(item.category || 'Misc')}</div>
      <div class="channel">${channelLabel(item.channel)} · sku ${escapeHtml(item.sku || '')}</div>
      <div class="title">Misc lot, ${fmt(item.tag_price)} each</div>
      <div class="priceline"><span>${item.qty} sold @ ${fmt(item.tag_price)}</span><span>${fmt(total)} total</span></div>
      ${bottomHtml}
    </div>`;
  }

  const priceRight = sold ? `<span>sold ${fmt(item.sold_price)}</span>` : `<span>${item.channel === 'estate_sale' ? 'listed' : 'in stock'}</span>`;
  return `<div class="tag" data-status="${sold ? 'sold' : 'active'}">
    <div class="string"></div><div class="hole"></div>
    ${stampHtml}
    <div class="cat">${escapeHtml(item.category || '')}</div>
    <div class="channel">${channelLabel(item.channel)}</div>
    <div class="title">${escapeHtml(item.title)}</div>
    <div class="priceline"><span class="tagprice ${sold ? 'struck' : ''}">${fmt(item.tag_price)}</span>${priceRight}</div>
    ${bottomHtml}
  </div>`;
}

router.get('/dashboard', requirePortalSession, (req, res) => {
  const { consignor, items, summary } = getDashboardData(req.session.consignor_code);
  const payoutFor = (item) => {
    const commission = COMMISSION[item.channel];
    const gross = item.is_misc ? item.tag_price * item.qty : item.sold_price;
    return gross * (1 - commission);
  };

  const isEstate = consignor.type === 'estate';
  const subline = isEstate
    ? 'Estate sale client — unsold items move to the storefront'
    : 'Direct consignment client — straight to the storefront';
  const pathBadge = isEstate ? 'Estate sale client' : 'Direct consignment client';

  const bars = [];
  if (isEstate && consignor.estate_sale_date) {
    const payDate = addDays(consignor.estate_sale_date, ESTATE_PAYOUT_DAYS);
    const ready = new Date() >= payDate;
    bars.push(`<div class="payoutbar">
      <div>Estate sale payout <span class="accrued">${fmt(summary.owedEstate)}</span> — items sold at the estate sale only</div>
      <div class="status ${ready ? 'ready' : ''}">${ready ? `ready — payable since ${fmtDate(payDate)}` : `payable ${fmtDate(payDate)}`}</div>
    </div>`);
  }
  const contractEnd = new Date(consignor.contract_end + 'T00:00:00');
  const storeReady = new Date() >= contractEnd;
  bars.push(`<div class="payoutbar">
    <div>Storefront payout <span class="accrued">${fmt(summary.owedStore)}</span> — paid out once your contract ends</div>
    <div class="status ${storeReady ? 'ready' : ''}">${storeReady ? `ready — contract ended ${fmtDate(contractEnd)}` : `contract ends ${fmtDate(contractEnd)}`}</div>
  </div>`);

  const cards = items.map(i => itemCard(i, payoutFor)).join('');

  res.send(page('Dashboard', `
    <div class="topbar">
      <div class="brand">The Vintage <span>Queen</span></div>
      <div class="who">${escapeHtml(consignor.name)}<form style="display:inline" method="post" action="/portal/logout"><button type="submit">Sign out</button></form></div>
    </div>
    <div class="subline">${subline}</div>
    <div class="pathbadge">${pathBadge}</div>
    <div id="payoutBars">${bars.join('')}</div>

    <div class="stats">
      <div class="stat"><div class="label">Active</div><div class="val">${summary.activeCount}</div></div>
      <div class="stat"><div class="label">Sold</div><div class="val">${summary.soldCount}</div></div>
      <div class="stat"><div class="label">Owed to you</div><div class="val">${fmt(summary.owedTotal)}</div></div>
    </div>

    <div class="tabs">
      <button class="tab active" data-f="all">All</button>
      <button class="tab" data-f="active">Active</button>
      <button class="tab" data-f="sold">Sold</button>
    </div>

    <div class="board" id="board">${cards || '<p class="empty">No items yet.</p>'}</div>

    <script>
      document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
          const f = btn.dataset.f;
          document.querySelectorAll('#board .tag').forEach(card => {
            card.classList.toggle('hidden', f !== 'all' && card.dataset.status !== f);
          });
        });
      });
    </script>
  `));
});

router.get('/', (req, res) => res.redirect('/portal/dashboard'));

export default router;
