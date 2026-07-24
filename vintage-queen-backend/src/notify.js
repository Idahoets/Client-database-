import nodemailer from 'nodemailer';
import crypto from 'crypto';
import 'dotenv/config';

const ACCOUNTING_EMAIL = process.env.ACCOUNTING_EMAIL || 'accounting@idahoets.com';
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false, // STARTTLS on 587, standard for Outlook/Office365
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
  return transporter;
}

async function sendEmail({ to, subject, text }) {
  const t = getTransporter();
  if (!t) {
    console.warn(`SMTP not configured (set SMTP_USER/SMTP_PASSWORD in .env) - would have emailed ${to}: "${subject}"`);
    return false;
  }
  await t.sendMail({ from: process.env.SMTP_USER, to, subject, text });
  return true;
}

export function newApprovalToken() {
  return crypto.randomBytes(24).toString('hex');
}

function approveUrl(reportId, token) {
  return `${BASE_URL}/api/reports/${reportId}/approve/${token}`;
}

function batchApproveUrl(token) {
  return `${BASE_URL}/api/reports/batch/${token}/approve`;
}

// The actual message a consignor receives - same content whether it goes out
// by email or gets read out for a text.
export function consignorMessage(report, consignor) {
  const details = JSON.parse(report.details_json || '{}');
  const isEstate = report.report_type === 'estate_payout';
  const label = isEstate ? 'Estate Sale Payout' : 'Storefront Statement';

  const body = isEstate
    ? `Hi ${consignor.name}, your estate sale payout is ready: $${report.amount.toFixed(2)} for ${details.item_count} item(s) sold at your ${details.estate_sale_date} estate sale. Thanks for consigning with The Vintage Queen!`
    : `Hi ${consignor.name}, your storefront statement: $${report.amount.toFixed(2)} for ${details.item_count} item(s) sold${details.payable ? ', payable now that your contract has ended.' : ' so far (still accruing - not yet payable until your contract ends).'} Thanks for consigning with The Vintage Queen!`;

  return { subject: `Your ${label} from The Vintage Queen - $${report.amount.toFixed(2)}`, text: body };
}

// Nothing goes to a consignor without accounting@idahoets.com reviewing and
// clicking approve first - this is the review copy, not the real send.
export async function sendReviewEmail(report, consignor) {
  const { subject, text } = consignorMessage(report, consignor);
  const url = approveUrl(report.id, report.approval_token);

  await sendEmail({
    to: ACCOUNTING_EMAIL,
    subject: `Review needed: ${subject}`,
    text: [
      `${report.delivery_method === 'text' ? 'Text' : 'Email'} to ${consignor.name} (${report.recipient || 'no contact on file'}):`,
      '',
      `Subject: ${subject}`,
      text,
      '',
      `Approve and send: ${url}`,
      '',
      'Nothing is sent to the consignor until you click the link above.'
    ].join('\n')
  });
}

// One digest email per monthly storefront-statement run instead of one email
// per consignor - includes every consignor in the batch, an individual
// approve link for each, and one link to approve the whole batch at once.
export async function sendMonthlyDigestEmail(reports, consignorsByCode) {
  if (!reports.length) return;

  const lines = reports.map(r => {
    const c = consignorsByCode[r.consignor_code];
    const details = JSON.parse(r.details_json || '{}');
    return `- ${c.name} (${r.consignor_code}): $${r.amount.toFixed(2)}, ${details.item_count} item(s), ` +
      `${details.payable ? 'PAYABLE NOW' : 'accruing'}, ${r.delivery_method} to ${r.recipient || 'no contact on file'} ` +
      `-> ${approveUrl(r.id, r.approval_token)}`;
  });

  const batchToken = reports[0].approval_token;

  await sendEmail({
    to: ACCOUNTING_EMAIL,
    subject: `Monthly storefront statements ready for review (${reports.length} consignors)`,
    text: [
      `${reports.length} storefront statements generated. Nothing is sent to any consignor until you approve.`,
      '',
      `Approve ALL and send everything: ${batchApproveUrl(batchToken)}`,
      '',
      'Or approve individually:',
      ...lines
    ].join('\n')
  });
}

export async function sendConsignorEmail(report, consignor) {
  const { subject, text } = consignorMessage(report, consignor);
  const sent = await sendEmail({ to: consignor.contact_email, subject, text });
  if (!sent) throw new Error('SMTP not configured - see .env');
}

// No SMS provider chosen yet (owner said "decide later") - this logs what
// would have gone out so nothing is silently lost once one is wired up.
export async function sendConsignorText(report, consignor) {
  const { text } = consignorMessage(report, consignor);
  console.warn(`SMS provider not configured yet - would have texted ${consignor.contact_phone}: "${text}"`);
  throw new Error('SMS provider not configured yet - see README');
}
