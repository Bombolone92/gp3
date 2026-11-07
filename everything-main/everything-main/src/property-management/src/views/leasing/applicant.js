/** One applicant: contact, unit, income check, screening, decision. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, statusPill, emptyState, moreButton, card } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { navigate } from '../../ui/router.js';
import { money, date, kvList, notesCard, deleteWithUndo } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { personName, telHref } from '../../core/format.js';
import { incomeRatio, ratioTone, SCREENING_ITEMS, screeningProgress } from './shared.js';
import { applicantRent, applicantUnitLabel, statusActions } from './applicants.js';
import { openCompose } from '../maintenance/shared.js';

const RATIO_TEXT = { good: 'Meets the usual 3x guideline', fair: 'Slightly under the usual 3x guideline', low: 'Well under the usual 3x guideline' };

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const body = ctx.live(() => {
    const a = store.get('applicants', id);
    if (!a) return emptyState({ icon: 'contact', title: 'Applicant not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/applicants' }, 'Back to applicants')] });
    const unit = lookup.unit(a.unitId);
    const rent = applicantRent(a);
    const ratio = incomeRatio(a.income, rent);
    const tone = ratioTone(ratio);
    const lease = a.leaseId ? lookup.lease(a.leaseId) : null;
    const prog = screeningProgress(a);

    const createLease = () => navigate(`/leases/new?applicantId=${a.id}${a.unitId ? `&unitId=${a.unitId}` : ''}`);
    const primary = lease
      ? h('a.btn.primary', { href: `#/leases/${lease.id}` }, icon('file-signature', 16), 'View lease')
      : a.status === 'approved' || a.status === 'converted' // converted, but the lease was deleted
        ? h('button.btn.primary', { type: 'button', onClick: createLease }, icon('file-signature', 16), 'Create lease')
        : a.status === 'new'
          ? h('button.btn.primary', { type: 'button', onClick: () => statusActions(a)[0].run() }, icon('clipboard-check', 16), 'Start screening')
          : a.status === 'screening'
            ? h('button.btn.primary', { type: 'button', onClick: () => statusActions(a).find((x) => x.label === 'Approve').run() }, icon('check', 16), 'Approve')
            : null;

    const more = moreButton((btn) =>
      openMenu(btn, [
        { label: 'Edit', icon: 'pencil', href: `#/applicants/${a.id}/edit` },
        a.email ? { label: 'Email applicant', icon: 'mail', run: () => openCompose({ to: [{ name: personName(a), email: a.email }], subject: unit ? `Your application for ${lookup.unitLabel(unit.id)}` : 'Your rental application', body: `Hi ${a.firstName || personName(a)},\n\n`, related: { type: 'applicant', id: a.id } }) } : null,
        ...statusActions(a).filter((x) => !(a.status === 'new' && x.label === 'Start screening') && !(a.status === 'screening' && x.label === 'Approve')),
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, run: () => deleteWithUndo('applicants', a, { title: 'Delete this applicant?', message: `${personName(a)} and their notes will be removed.`, label: 'Applicant deleted', after: () => navigate('/applicants') }) },
      ]),
    );

    const screening = h(
      'ul.screening',
      SCREENING_ITEMS.map((it) =>
        h(
          'li',
          h(
            'label.check',
            h('input', {
              type: 'checkbox',
              checked: !!a.screening?.[it.id],
              disabled: ['converted'].includes(a.status) || null,
              onChange: (e) => {
                store.patch('applicants', a.id, (x) => ((x.screening = { ...(x.screening || {}), [it.id]: e.target.checked }), x));
                if (e.target.checked && a.status === 'new') store.patch('applicants', a.id, { status: 'screening' });
              },
            }),
            it.label,
          ),
        ),
      ),
    );

    const main = h(
      'div.detail-main',
      card({
        title: 'Income check',
        body: h(
          'div.income-check',
          h('div.income-figures', h('div', h('span.stat-label', 'Monthly income'), h('span.big-num', a.income ? money(a.income) : 'Not given')), h('div', h('span.stat-label', 'Monthly rent'), h('span.big-num', rent ? money(rent) : 'No unit')), h('div', h('span.stat-label', 'Ratio'), h(`span.big-num.ratio-text-${tone || 'none'}`, ratio === null ? 'Not available' : `${ratio}x`))),
          ratio !== null ? h(`div.ratio-bar.ratio-${tone}`, { role: 'img', 'aria-label': `Income is ${ratio} times the rent` }, h('span', { style: { width: `${Math.min(100, (ratio / 4) * 100)}%` } }), h('i', { style: { left: '75%' }, title: '3x rent' })) : null,
          h('p.subtle', ratio === null ? 'Add the applicant income and a unit to compare them.' : RATIO_TEXT[tone]),
        ),
      }),
      card({ title: 'Screening', count: `${prog.done} of ${prog.total}`, body: h('div.stack', screening, h('p.subtle', { style: { fontSize: '12px' } }, 'Checks save as you tick them.')) }),
      notesCard('applicants', a),
      attachmentsCard('applicants', a, { title: 'Application files' }),
    );
    const aside = h(
      'div.detail-aside',
      card({
        title: 'Contact',
        body: kvList([
          ['Email', a.email ? h('a', { href: `mailto:${a.email}` }, a.email) : null],
          ['Phone', a.phone ? h('a', { href: telHref(a.phone) }, a.phone) : null],
          ['Employer', a.employer || null],
          ['Source', a.source || null],
        ]),
      }),
      card({
        title: 'Application',
        body: kvList([
          ['Status', statusPill(a.status)],
          ['Unit', unit ? h('a', { href: `#/units/${unit.id}` }, applicantUnitLabel(a)) : applicantUnitLabel(a)],
          ['Applied', date(a.appliedOn)],
          ['Desired move-in', a.moveIn ? date(a.moveIn) : 'Not given'],
          ['Decided', a.decidedOn ? date(a.decidedOn) : null],
          ['Lease', lease ? h('a', { href: `#/leases/${lease.id}` }, `Lease ${lease.number || ''}`.trim()) : null],
        ]),
      }),
    );
    return h(
      'div',
      pageHeader({ title: personName(a), crumbs: [{ label: 'Applicants', href: '#/applicants' }], after: h('div.row.header-pills', statusPill(a.status), unit ? h('span.subtle', applicantUnitLabel(a)) : null), actions: [more, primary] }),
      a.status === 'approved' && !lease ? h('div.notice.accent', icon('check'), h('span.grow', 'Approved. Create the lease to move this applicant in.'), h('button.btn.sm.primary', { type: 'button', onClick: createLease }, 'Create lease')) : null,
      h('div.detail', main, aside),
    );
  }, ['applicants', 'units', 'leases']);
  return { node: h('div.page', body), title: personName(store.get('applicants', id)) || 'Applicant' };
}

