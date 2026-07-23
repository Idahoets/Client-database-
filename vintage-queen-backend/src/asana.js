import 'dotenv/config';

const TOKEN = process.env.ASANA_TOKEN;
const PROJECT_ID = process.env.ASANA_PROJECT_ID;

// Match custom fields by gid, not name - a couple of fields in this project
// have had duplicate/junk fields with the same display name before.
const FIELD = {
  email: '1212596660527248',
  contractStart: '1216838717056492',
  estateSaleDates: '1216838570025456'
};

async function asanaGet(path, params = {}) {
  const url = new URL(`https://app.asana.com/api/1.0${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asana API error ${res.status}: ${body}`);
  }
  return res.json();
}

function fieldValue(task, gid) {
  const field = task.custom_fields?.find(f => f.gid === gid);
  if (!field) return null;
  return 'date_value' in field ? (field.date_value?.date ?? null) : (field.text_value ?? null);
}

// "Estate Sale Dates" is free text like "6/26-6/27", not a real date field -
// the 7-day payout countdown counts from the *later* date in the range.
// There's no year in the text, so fall back to the contract-start year.
function parseEstateSaleDate(rangeText, fallbackYear) {
  if (!rangeText) return null;
  const last = rangeText.split('-').pop().trim();
  const m = last.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return `${fallbackYear}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function wordSet(name) {
  return name.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}

// Pulls the Client Database Asana project and returns normalized consignor
// records, plus a separate `flagged` list for anything that shouldn't be
// silently imported (possible duplicate tasks, by same-name-different-order -
// e.g. "Harrison, Sue" vs "Sue harrison"). Duplicates are never auto-merged;
// they're surfaced for a human to resolve.
//
// Contract type isn't a structured field - inferred from whether Estate Sale
// Dates is filled in. This (and contract_start being populated at all) only
// works reliably for clients added/updated recently; most historical/
// completed tasks predate these fields and are returned with contractStart:
// null, which callers should treat as "not enough data to seed yet" rather
// than guessing a date.
export async function getConsignorTasks() {
  const data = await asanaGet(`/projects/${PROJECT_ID}/tasks`, {
    opt_fields: 'name,completed,due_on,custom_fields.gid,custom_fields.date_value,custom_fields.text_value'
  });

  const flagged = [];
  const seen = new Map();
  const tasks = [];

  for (const task of data.data || []) {
    const name = task.name.trim();
    const key = wordSet(name);
    if (seen.has(key)) {
      flagged.push({ reason: 'possible duplicate task', task: name, gid: task.gid, duplicateOf: seen.get(key) });
    } else {
      seen.set(key, { task: name, gid: task.gid });
    }

    const email = fieldValue(task, FIELD.email);
    const contractStart = fieldValue(task, FIELD.contractStart);
    const estateSaleDatesRaw = fieldValue(task, FIELD.estateSaleDates);
    const fallbackYear = contractStart ? contractStart.slice(0, 4) : String(new Date().getFullYear());

    tasks.push({
      gid: task.gid,
      name,
      email,
      contractStart,
      estateSaleDate: parseEstateSaleDate(estateSaleDatesRaw, fallbackYear),
      type: estateSaleDatesRaw ? 'estate' : 'direct',
      contractEnd: task.due_on // per owner: this task's due_on IS the 90-day contract end, not a generic due date
    });
  }

  return { tasks, flagged };
}
