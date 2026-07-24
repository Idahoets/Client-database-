import nodemailer from 'nodemailer';
import crypto from 'crypto';
import 'dotenv/config';

const ACCOUNTING_EMAIL = process.env.ACCOUNTING_EMAIL || 'accounting@idahoets.com';
// Render sets RENDER_EXTERNAL_URL automatically - prefer that so approve
// links work out of the box after a deploy, no manual PUBLIC_BASE_URL step.
const BASE_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

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

// The actual message a consignor receives.
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
      `Email to ${consignor.name} (${report.recipient}):`,
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

// No email on file and no text messages (owner decision) - there's no
// automated way to deliver this one, so just let accounting@ know it needs a
// phone call, mailed check, or similar, with the numbers they'd need.
export async function sendNeedsManualOutreachEmail(consignor, reportType, amount) {
  const label = reportType === 'estate_payout' ? 'Estate Sale Payout' : 'Storefront Statement';
  await sendEmail({
    to: ACCOUNTING_EMAIL,
    subject: `Needs manual outreach: ${consignor.name} - $${amount.toFixed(2)} ${label}`,
    text: `${consignor.name} (${consignor.code}) has a ${label.toLowerCase()} of $${amount.toFixed(2)} ready, but no email on file and no text messages are sent - this one needs a phone call, mailed check, or other manual contact.${consignor.contact_phone ? ` Phone on file: ${consignor.contact_phone}.` : ' No phone on file either.'}`
  });
}

// One digest email per monthly storefront-statement run instead of one email
// per consignor - includes every consignor with something owed, an
// individual approve link for each, one link to approve the whole batch at
// once, and a separate section for anyone with no email on file (no
// automated way to reach them - no text messages, per owner decision).
export async function sendMonthlyDigestEmail(reports, consignorsByCode, needsManual = []) {
  if (!reports.length && !needsManual.length) return;

  const lines = reports.map(r => {
    const c = consignorsByCode[r.consignor_code];
    const details = JSON.parse(r.details_json || '{}');
    return `- ${c.name} (${r.consignor_code}): $${r.amount.toFixed(2)}, ${details.item_count} item(s), ` +
      `${details.payable ? 'PAYABLE NOW' : 'accruing'}, email to ${r.recipient} -> ${approveUrl(r.id, r.approval_token)}`;
  });

  const manualLines = needsManual.map(({ consignor, amount }) =>
    `- ${consignor.name} (${consignor.code}): $${amount.toFixed(2)} - no email on file${consignor.contact_phone ? `, phone: ${consignor.contact_phone}` : ', no phone on file either'} - needs manual outreach, no approve link`
  );

  const parts = [`${reports.length} storefront statement(s) ready to approve, ${needsManual.length} need manual outreach. Nothing is sent to any consignor until you approve.`, ''];

  if (reports.length) {
    parts.push(`Approve ALL and send everything: ${batchApproveUrl(reports[0].approval_token)}`, '', 'Or approve individually:', ...lines);
  }
  if (manualLines.length) {
    parts.push('', 'Needs manual outreach (no email on file, no text messages):', ...manualLines);
  }

  await sendEmail({
    to: ACCOUNTING_EMAIL,
    subject: `Monthly storefront statements ready for review (${reports.length} to approve, ${needsManual.length} manual)`,
    text: parts.join('\n')
  });
}

export async function sendConsignorEmail(report, consignor) {
  const { subject, text } = consignorMessage(report, consignor);
  const sent = await sendEmail({ to: consignor.contact_email, subject, text });
  if (!sent) throw new Error('SMTP not configured - see .env');
}
