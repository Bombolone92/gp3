/**
 * Compose an email to tenants, owners, vendors or anyone else, from
 * anywhere in the app:
 *
 *   composeEmail({ to: [{ name, email }], subject, body, related: { leaseId, propertyId, tenantId, ... }, template })
 *
 * Sends through the app's email worker when it is reachable; otherwise the
 * message can be opened in the user's own email app or copied. Every
 * message, sent or not, is kept in the communication log.
 */
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { field, textInput, textarea, select, combobox } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { displayName, matches, personName } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { monthlyRent, leaseStatus, rentItem } from '../core/leases.js';
import { newId } from '../core/ids.js';
import { money } from './common.js';
import { sendEmail, mailerAvailable, describeResult, recipientResults, mailtoHref, isEmail, MAX_TOTAL_RECIPIENTS, MAX_SUBJECT_CHARS, MAX_BODY_CHARS } from '../mailer.js';

/** Everyone with an email address, for the recipient picker. */
export function contactOptions(store = app.store, today = app.today()) {
  const out = [];
  const leaseOf = new Map();
  for (const l of store.all('leases')) if (!l.draft && leaseStatus(l, today) !== 'past') for (const t of l.tenantIds || []) leaseOf.set(t, l);
  for (const t of store.all('tenants')) {
    for (const email of t.emails || []) {
      const l = leaseOf.get(t.id);
      out.push({ key: `t:${t.id}:${email}`, name: personName(t), email, kind: 'Tenant', sub: l ? lookup.leaseLabel(l) : 'Tenant', tenantId: t.id });
    }
  }
  for (const o of store.all('owners')) for (const email of o.emails || []) out.push({ key: `o:${o.id}:${email}`, name: displayName(o), email, kind: 'Owner', sub: 'Rental owner', ownerId: o.id });
  for (const v of store.all('vendors')) for (const email of v.emails || []) out.push({ key: `v:${v.id}:${email}`, name: displayName(v), email, kind: 'Vendor', sub: v.category || 'Vendor', vendorId: v.id });
  for (const m of store.all('team')) if (m.email) out.push({ key: `m:${m.id}`, name: m.name, email: m.email, kind: 'Team', sub: m.role || 'Team' });
  return out;
}

/** Recipients for a lease: every tenant on it that has an email address. */
export function leaseRecipients(lease, store = app.store) {
  return (lease?.tenantIds || [])
    .map((id) => store.get('tenants', id))
    .filter(Boolean)
    .flatMap((t) => (t.emails || []).slice(0, 1).map((email) => ({ name: personName(t), email, tenantId: t.id })));
}

export const TEMPLATES = [
  { id: 'general', label: 'General message' },
  { id: 'rent-reminder', label: 'Rent reminder' },
  { id: 'late-notice', label: 'Late rent notice' },
  { id: 'renewal-offer', label: 'Renewal offer' },
];

/**
 * Fill a template for a lease (when given). Returns { subject, body }.
 * Pure apart from formatting, so it is unit tested.
 */
/** 1 -> "1st", 2 -> "2nd", 15 -> "15th", 22 -> "22nd" */
function ordinal(n) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

export function fillTemplate(id, { lease = null, unitLabel = '', balance = 0, rent = 0, rentDay = 1, company = '', fmt = (c) => String(c / 100), today }) {
  const sign = company ? `\n\nThank you,\n${company}` : '\n\nThank you.';
  const where = unitLabel ? ` for ${unitLabel}` : '';
  switch (id) {
    case 'rent-reminder':
      return {
        subject: `Rent reminder${where}`,
        body: `Hello,\n\nThis is a friendly reminder that rent${rent ? ` of ${fmt(rent)}` : ''} is due on the ${ordinal(Math.min(31, Math.max(1, Number(rentDay) || 1)))} of the month${where}.${balance > 0 ? ` Your current balance is ${fmt(balance)}.` : ''}\n\nIf you have already paid, please disregard this message.${sign}`,
      };
    case 'late-notice':
      return {
        subject: `Past due balance${where}`,
        body: `Hello,\n\nOur records show a past due balance of ${fmt(Math.max(0, balance))}${where} as of ${formatDate(today, { month: 'long', day: 'numeric', year: 'numeric' })}. Please pay the balance as soon as possible to avoid additional late fees.\n\nIf you have questions about your balance or need to discuss a payment plan, reply to this email.${sign}`,
      };
    case 'renewal-offer': {
      const offer = lease?.renewal?.offerRent || rent;
      const end = lease?.renewal?.offerEnd;
      return {
        subject: `Lease renewal offer${where}`,
        body: `Hello,\n\nYour lease${where} ends on ${lease?.end ? formatDate(lease.end, { month: 'long', day: 'numeric', year: 'numeric' }) : 'soon'}. We would be glad to have you stay. We are offering a renewal${end ? ` through ${formatDate(end, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}${offer ? ` at a monthly rent of ${fmt(offer)}` : ''}.\n\nPlease reply to let us know whether you would like to renew.${sign}`,
      };
    }
    default:
      return { subject: '', body: `Hello,\n\n\n${sign.trimStart()}` };
  }
}

/** Save a message to the communication log. */
export function logMessage(rec) {
  return app.store.put('messages', { at: new Date().toISOString(), by: app.user?.username || (app.demo ? 'Demo user' : ''), ...rec });
}

export function composeEmail({ to = [], subject = '', body = '', related = {}, template = null, title = 'New email', id = null, kind = 'email' } = {}) {
  const store = app.store;
  const lease = related.leaseId ? store.get('leases', related.leaseId) : null;
  const recipients = [];
  const keyOf = (r) => r.email.toLowerCase();
  const addRecipient = (r) => {
    if (!r?.email || !isEmail(r.email)) return false;
    if (recipients.some((x) => keyOf(x) === keyOf(r))) return true;
    if (recipients.length >= MAX_TOTAL_RECIPIENTS) {
      toast(`Send to at most ${MAX_TOTAL_RECIPIENTS} people at once.`, { type: 'error' });
      return false;
    }
    recipients.push({ name: r.name || '', email: r.email.trim(), ...(r.tenantId ? { tenantId: r.tenantId } : {}) });
    drawChips();
    return true;
  };

  const chipList = h('ul.recipient-chips', { 'aria-label': 'Recipients' });
  const subjectIn = textInput({ name: 'subject', value: subject, placeholder: 'Subject', maxlength: MAX_SUBJECT_CHARS });
  const bodyIn = textarea({ name: 'body', value: body, rows: 10, maxlength: MAX_BODY_CHARS });
  const templateSel = select({ name: 'template', value: template || 'general', options: TEMPLATES.map((t) => ({ value: t.id, label: t.label })) });
  const status = h('p.compose-status', { role: 'status', 'aria-live': 'polite' });

  function drawChips() {
    chipList.replaceChildren(
      ...recipients.map((r, i) =>
        h(
          'li.recipient-chip',
          h('span.truncate', { title: r.email }, r.name ? `${r.name} ` : '', h('span.subtle', r.name ? `<${r.email}>` : r.email)),
          h(
            'button.icon-btn.sm',
            {
              type: 'button',
              'aria-label': `Remove ${r.name || r.email}`,
              onClick: () => {
                recipients.splice(i, 1);
                drawChips();
                picker.input.focus();
              },
            },
            icon('x', 14),
          ),
        ),
      ),
    );
    chipList.hidden = !recipients.length;
  }

  const picker = combobox({
    label: 'Add recipient',
    placeholder: 'Add a tenant, owner, vendor or email address',
    items: () => contactOptions().filter((c) => !recipients.some((r) => keyOf(r) === c.email.toLowerCase())),
    itemLabel: (c) => `${c.name} <${c.email}>`,
    filter: (c, q) => matches(`${c.name} ${c.email} ${c.sub} ${c.kind}`, q),
    renderItem: (c) => h('span.combo-item', h('span.grow', h('span.combo-title', c.name), h('span.combo-sub', `${c.kind} · ${c.email}${c.sub && c.sub !== c.kind ? ' · ' + c.sub : ''}`))),
    onSelect: (c) => {
      addRecipient(c);
      picker.input.value = '';
    },
    footerAction: {
      label: (q) => (isEmail(q) ? `Add ${q.trim()}` : 'Type a full email address to add it'),
      run: (q) => {
        if (addRecipient({ email: q.trim() })) picker.input.value = '';
        else if (q.trim()) toast(`"${q.trim()}" is not an email address.`, { type: 'error' });
      },
    },
  });
  // Typing an address and pressing comma or Enter adds it directly.
  picker.input.addEventListener('keydown', (e) => {
    if ((e.key === ',' || e.key === ';' || (e.key === 'Enter' && isEmail(picker.input.value))) && picker.input.value.trim()) {
      if (addRecipient({ email: picker.input.value.trim().replace(/[,;]$/, '') })) {
        e.preventDefault();
        picker.input.value = '';
      }
    }
  });

  for (const r of to) addRecipient(r);
  if (!to.length && lease) for (const r of leaseRecipients(lease)) addRecipient(r);

  const applyTemplate = (id) => {
    const info = lease ? app.ledger().lease(lease.id) : null;
    const filled = fillTemplate(id, {
      lease,
      unitLabel: lease ? lookup.leaseLabel(lease) : related.propertyId ? lookup.property(related.propertyId)?.name || '' : '',
      balance: info?.balance || 0,
      rent: lease ? monthlyRent(lease, app.today()) : 0,
      rentDay: (lease && rentItem(lease)?.day) || app.settings().leases?.rentDay || 1,
      company: app.settings().company?.name || '',
      fmt: money,
      today: app.today(),
    });
    subjectIn.value = filled.subject;
    bodyIn.value = filled.body;
  };
  templateSel.addEventListener('change', () => applyTemplate(templateSel.value));
  if (template || (!subject && !body)) applyTemplate(template || 'general');

  const canSend = mailerAvailable() && !app.demo;
  const messageBase = () => ({
    kind,
    subject: subjectIn.value.trim(),
    body: bodyIn.value,
    to: recipients.map((r) => ({ ...r })),
    propertyId: related.propertyId || lease?.propertyId || null,
    leaseId: related.leaseId || null,
    ...(related.tenantId ? { tenantId: related.tenantId } : {}),
    ...(related.ownerId ? { ownerId: related.ownerId } : {}),
    ...(related.vendorId ? { vendorId: related.vendorId } : {}),
    ...(related.workOrderId ? { workOrderId: related.workOrderId } : {}),
  });

  const validate = () => {
    if (!recipients.length) {
      status.textContent = 'Add at least one recipient.';
      picker.input.focus();
      return false;
    }
    if (!subjectIn.value.trim()) {
      status.textContent = 'Add a subject.';
      subjectIn.setAttribute('aria-invalid', 'true');
      subjectIn.focus();
      return false;
    }
    if (!bodyIn.value.trim()) {
      status.textContent = 'Write a message.';
      bodyIn.focus();
      return false;
    }
    return true;
  };

  return new Promise((resolve) => {
    let result = null;
    let busy = false;
    picker.input.id = uniqueId('compose-to');
    // One id for the message, kept across retries, so a failed send that is
    // retried updates its log entry and the worker can skip duplicates.
    const msgId = id || newId();
    openDialog({
      title,
      size: 'wide',
      onClose: () => resolve(result),
      body: () =>
        h(
          'div.compose',
          h('div.field', h('label', { for: picker.input.id }, 'To'), chipList, picker),
          h('div.form-grid', field('Template', templateSel), h('div')),
          field('Subject', subjectIn),
          field('Message', bodyIn, { hint: 'Plain text. Each person receives their own copy and cannot see the other recipients.' }),
          !canSend
            ? h('div.notice', icon('info'), h('span', app.demo ? 'Email is not sent from the sample portfolio. Use Open in email app or Copy, or Save to log.' : 'Email sending is not available right now. Open the message in your email app or copy it; it is still saved to the log.'))
            : null,
          status,
        ),
      footer: ({ close }) => {
        const sendBtn = h('button.btn.primary', { type: 'button', disabled: !canSend || null }, icon('send', 16), 'Send');
        const mailtoBtn = h('button.btn', { type: 'button' }, icon('external', 16), h('span.hide-mobile', 'Open in email app'), h('span.show-mobile', 'Email app'));
        const copyBtn = h('button.btn.ghost', { type: 'button' }, icon('copy', 16), 'Copy');
        const logBtn = !canSend ? h('button.btn.ghost', { type: 'button' }, icon('archive', 16), 'Save to log') : null;

        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(`Subject: ${subjectIn.value}\n\n${bodyIn.value}`);
            toast('Message copied');
          } catch {
            toast('Could not copy. Select the text and copy it instead.', { type: 'error' });
          }
        });
        mailtoBtn.addEventListener('click', () => {
          if (!validate()) return;
          result = logMessage({ ...messageBase(), status: 'logged', note: 'Opened in email app' });
          location.href = mailtoHref({ to: recipients, subject: subjectIn.value, body: bodyIn.value });
          close();
        });
        logBtn?.addEventListener('click', () => {
          if (!validate()) return;
          result = logMessage({ ...messageBase(), status: 'logged' });
          close();
          toast('Saved to the communication log');
        });
        sendBtn.addEventListener('click', async () => {
          if (busy || !validate()) return;
          busy = true;
          sendBtn.disabled = true;
          status.textContent = recipients.length > 5 ? `Sending to ${recipients.length} people...` : 'Sending...';
          const base = messageBase();
          try {
            const out = await sendEmail({
              id: msgId,
              kind,
              to: recipients,
              subject: base.subject,
              body: base.body,
              senderName: app.settings().company?.name || '',
              replyTo: app.settings().company?.email || '',
            });
            const summary = describeResult(out);
            result = logMessage({ ...base, id: msgId, status: summary.ok ? 'sent' : 'failed', results: recipientResults(out), error: summary.ok && !summary.partial ? '' : summary.message });
            close();
            toast(summary.message, { type: !summary.ok ? 'error' : summary.partial ? 'info' : 'success', ...(summary.partial ? { duration: 8000 } : {}) });
          } catch (err) {
            busy = false;
            sendBtn.disabled = false;
            status.textContent = err.message;
            result = logMessage({ ...base, id: msgId, status: 'failed', error: err.message });
          }
        });
        return [copyBtn, logBtn, h('div.spacer'), h('button.btn.ghost.hide-mobile', { type: 'button', onClick: () => close() }, 'Cancel'), mailtoBtn, sendBtn];
      },
      initialFocus: recipients.length ? (subject ? 'textarea' : 'input[name="subject"]') : '.combo input',
    });
  });
}
