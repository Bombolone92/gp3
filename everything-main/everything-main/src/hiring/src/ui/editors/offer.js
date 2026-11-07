/** Offer editor, letter preview, and the e-signature recording dialog. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { copyText, downloadFile, field } from '../components.js';
import { openModal } from '../modal.js';
import { toast } from '../toast.js';
import { isActive } from '../../core/pipeline.js';
import { isOpenOffer, offerLetterText, offerTemplate } from '../../core/offers.js';
import { addDays, todayISO } from '../../lib/dates.js';
import { fileSlug } from '../../lib/format.js';
import { CURRENCIES, errorRegion, optionSelect, parsedValue, runSave } from './form.js';

export function openOfferEditor(ctx, offer = null, { candidateId = null } = {}) {
  const isNew = !offer;
  const { store } = ctx;
  const errors = errorRegion();

  const fixedId = candidateId ?? offer?.candidateId ?? null;
  const fixedCandidate = fixedId ? store.state.candidates.find((c) => c.id === fixedId) : null;
  const eligible = fixedCandidate
    ? [fixedCandidate]
    : store.state.candidates.filter(
        (c) => isActive(c) && !store.state.offers.some((o) => o.candidateId === c.id && isOpenOffer(o))
      );
  if (eligible.length === 0) {
    // Three different dead ends, and only the first is "there is nobody
    // here": an account whose candidates are all archived was told to add
    // one while looking at a full archive tab, with no hint that Restore
    // is what unblocks it.
    toast(
      store.state.candidates.some(isActive)
        ? 'Every active candidate already has an open offer.'
        : store.state.candidates.length > 0
          ? 'Every candidate is archived. Restore one, or re-engage a talent-pool member, to draft an offer.'
          : 'Add a candidate first, then draft their offer.',
      'error'
    );
    return;
  }

  const candidateSelect = el(
    'select',
    { class: 'select', disabled: Boolean(fixedCandidate) },
    eligible.map((c) => {
      const job = store.state.jobs.find((j) => j.id === c.jobId);
      return el(
        'option',
        { value: c.id, selected: c.id === fixedId },
        `${c.name}${job ? ` · ${job.title}` : ''}`
      );
    })
  );

  // Salary and currency share one visual label; name each control for AT.
  const salary = el('input', { class: 'input', type: 'number', min: '0', step: '1000', value: offer?.salary ?? '', placeholder: 'Base salary per year', 'aria-label': 'Base salary per year' });
  const currency = optionSelect(CURRENCIES, offer?.currency ?? 'USD');
  currency.setAttribute('aria-label', 'Currency');
  const bonus = el('input', { class: 'input', type: 'number', min: '0', step: '500', value: offer?.bonus ?? '', placeholder: 'Optional' });
  const equity = el('input', { class: 'input', type: 'text', value: offer?.equity ?? '', placeholder: 'e.g. 0.05% over 4 years' });
  const startDate = el('input', { class: 'input', type: 'date', value: offer?.startDate ?? addDays(todayISO(), 30) });
  const expires = el('input', { class: 'input', type: 'date', value: offer?.expires ?? '' });
  const notes = el('textarea', { class: 'textarea', rows: 3, placeholder: 'Extra terms that should appear in the letter: relocation, budget, visa support…' });
  notes.value = offer?.notes ?? '';

  const save = el('button', { class: 'btn btn-primary' }, isNew ? 'Create draft' : 'Save changes');
  save.addEventListener('click', async () => {
    const ok = await runSave(save, errors, async () => {
      // Inside runSave so an unparseable optional field (a pasted
      // "$5,000" bonus, a half-picked expiry) lands in the error region
      // instead of silently saving as "no bonus" / "never expires" and
      // deleting its line from the offer letter.
      const bonusValue = parsedValue(bonus, 'The signing bonus');
      const expiresValue = parsedValue(expires, 'The expiry date') || null;
      // A deadline that has already gone by is a mistyped year or a
      // forgotten draft, never a term: the generated letter would tell
      // the candidate the offer "remains open until" a date in the past,
      // and sending it puts the offer straight into "Expired. Follow up
      // or withdraw". Today itself is still open, as it is everywhere
      // else the expiry is read.
      if (expiresValue && expiresValue < todayISO()) {
        throw new Error('That expiry date has already passed. Pick a later one, or clear the field.');
      }
      const data = {
        salary: parsedValue(salary, 'The base salary'),
        currency: currency.value,
        bonus: bonusValue === '' ? null : Number(bonusValue),
        equity: equity.value,
        startDate: parsedValue(startDate, 'The start date'),
        expires: expiresValue,
        notes: notes.value,
      };
      if (isNew) await store.createOffer({ candidateId: candidateSelect.value, ...data });
      else await store.updateOffer(offer.id, data);
    });
    if (ok) {
      modal.close();
      toast(isNew ? 'Draft offer created' : 'Offer updated');
    }
  });

  const modal = openModal({
    title: isNew ? 'New offer' : 'Edit offer',
    content: el(
      'div',
      { class: 'form-grid' },
      el('div', { class: 'span-2' }, field('Candidate', candidateSelect, 'off-candidate')),
      el(
        'div',
        { class: 'span-2' },
        field('Base salary (per year)', el('div', { class: 'input-row' }, salary, currency))
      ),
      field('Signing bonus', bonus, 'off-bonus'),
      field('Equity', equity, 'off-equity'),
      field('Start date', startDate, 'off-start'),
      field('Offer expires', expires, 'off-expires'),
      el('div', { class: 'span-2' }, field('Letter notes', notes, 'off-notes')),
      el('div', { class: 'span-2' }, errors.node)
    ),
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });
}

/** Read-only letter preview with copy / download — the "document" output. */
export function openOfferLetter(ctx, offer) {
  const { store } = ctx;
  const candidate = store.state.candidates.find((c) => c.id === offer.candidateId);
  const job = store.state.jobs.find((j) => j.id === offer.jobId);
  if (!candidate || !job) {
    toast('The candidate or job for this offer no longer exists.', 'error');
    return;
  }
  const text = offerLetterText(offer, candidate, job, {
    companyName: store.state.settings.companyName || 'Our company',
    template: offerTemplate(store.state.settings),
  });

  const modal = openModal({
    title: 'Offer letter',
    wide: true,
    content: el('pre', { class: 'letter' }, text),
    footer: [
      el(
        'button',
        { class: 'btn', onClick: () => copyText(text, 'Letter copied. Paste it into a doc or email') },
        icon('copy', 15),
        'Copy'
      ),
      el(
        'button',
        {
          class: 'btn',
          onClick: () => downloadFile(`offer-${fileSlug(candidate.name)}.txt`, text),
        },
        icon('download', 15),
        'Download'
      ),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn btn-primary', onClick: () => modal.close() }, 'Done'),
    ],
  });
}

/** Records the electronic signature: type the full name, exactly. */
export function openSignOffer(ctx, offer) {
  const candidate = ctx.store.state.candidates.find((c) => c.id === offer.candidateId);
  const errors = errorRegion();
  const name = el('input', { class: 'input', type: 'text', placeholder: candidate?.name ?? 'Full name' });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && sign.click());

  const sign = el('button', { class: 'btn btn-primary' }, icon('signature', 15), 'Record signature');
  sign.addEventListener('click', async () => {
    const ok = await runSave(sign, errors, () => ctx.store.signOffer(offer.id, name.value));
    if (ok) {
      modal.close();
      toast(`Offer signed. ${candidate?.name ?? 'The candidate'} is hired`);
    }
  });

  const modal = openModal({
    title: 'Record signature',
    content: [
      el(
        'p',
        { class: 'confirm-message' },
        'Type the signer’s full name as it should appear on the record. This marks the offer as signed, moves the candidate to Hired, and starts their onboarding plan.'
      ),
      field('Signed by', name, 'sign-name'),
      errors.node,
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), sign],
  });
}
