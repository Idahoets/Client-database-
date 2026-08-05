import 'dotenv/config';

const BASE = process.env.CLOVER_API_BASE;
const MERCHANT_ID = process.env.CLOVER_MERCHANT_ID;
const TOKEN = process.env.CLOVER_ACCESS_TOKEN;

async function cloverGet(path, params = {}) {
  const url = new URL(`${BASE}/v3/merchants/${MERCHANT_ID}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Clover API error ${res.status}: ${body}`);
  }
  return res.json();
}

const PAGE_SIZE = 1000;

// Clover caps every list response at 1000 elements regardless of how much
// data actually matches - anything beyond that silently doesn't come back
// unless you page through with offset. Verified this was actually dropping
// real sales (not just a theoretical gap): the account has 35,000+ orders
// going back to 2023, and a single unpaginated call only ever saw the most
// recent ~1000.
async function cloverGetAllPages(path, baseParams) {
  let all = [];
  let offset = 0;
  while (true) {
    const data = await cloverGet(path, { ...baseParams, limit: PAGE_SIZE, offset });
    const page = data.elements || [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// Pulls all inventory items (used to see SKUs and current price/stock)
export async function getItems() {
  return cloverGetAllPages('/items', { expand: 'categories' });
}

// Pulls orders modified since a given timestamp (ms), with line items and
// their categories expanded. Clover's `filter=modifiedTime>=X` limits how
// much has to be paged through on routine (incremental) syncs - only a full
// backfill (sinceMs near 0) pages through everything.
export async function getOrdersSince(sinceMs) {
  return cloverGetAllPages('/orders', { expand: 'lineItems.item.categories', filter: `modifiedTime>=${sinceMs}` });
}

// Clover order objects don't carry a native "which register/location" flag,
// but real order history shows the storefront register (one device.id) in
// use on almost every business day, while a handful of other devices each
// only show up for a day or two at a time - those map to one-off events:
//   - ESTATE_SALE_DEVICE_IDS: confirmed consignor estate sales (40% commission,
//     payout 7 days after the sale)
//   - EXCLUDED_DEVICE_IDS: one-off sales that use the same checkout style by
//     coincidence but aren't consignor business at all (e.g. warehouse sales) -
//     these orders are skipped entirely, not counted as estate or storefront
function deviceIdList(envVar) {
  return (process.env[envVar] || '').split(',').map(s => s.trim()).filter(Boolean);
}

const ESTATE_DEVICE_IDS = deviceIdList('ESTATE_SALE_DEVICE_IDS');
const EXCLUDED_DEVICE_IDS = deviceIdList('EXCLUDED_DEVICE_IDS');

export function classifyOrderChannel(order) {
  const deviceId = order.device?.id;
  if (EXCLUDED_DEVICE_IDS.includes(deviceId)) return 'excluded';
  if (ESTATE_DEVICE_IDS.includes(deviceId)) return 'estate_sale';
  return 'storefront';
}
