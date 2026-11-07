/** Offers: every offer across jobs, with its lifecycle actions. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { avatar, badge, emptyState, offerStatusBadge, segmented } from '../components.js';
import { openOfferEditor } from '../editors/offer.js';
import { offerActions } from './candidate.js';
import { isOpenOffer } from '../../core/offers.js';
import { isActive } from '../../core/pipeline.js';
import { daysBetween, formatDate, formatTimestamp, todayISO } from '../../lib/dates.js';
import { formatMoney, plural } from '../../lib/format.js';

export function renderOffers(ctx) {
  const { store, ui } = ctx;
  const { offers, candidates, jobs } = store.state;
  const tab = ui.offerTab ?? 'open';
  const today = todayISO();

  const shown = offers
    .filter((o) => (tab === 'open' ? isOpenOffer(o) : !isOpenOffer(o)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const header = el(
    'div',
    { class: 'view-header' },
    el(
      'div',
      {},
      el('h1', {}, 'Offers'),
      el('p', { class: 'subtitle' }, plural(offers.filter(isOpenOffer).length, 'open offer'))
    ),
    el(
      'div',
      { class: 'view-actions' },
      segmented(
        [
          { value: 'open', label: 'Open' },
          { value: 'closed', label: 'Resolved' },
        ],
        tab,
        (v) => {
          ui.offerTab = v;
          ctx.refresh();
        },
        'Offer state'
      ),
      el('button', { class: 'btn btn-primary', onClick: () => openOfferEditor(ctx) }, icon('plus', 15), 'New offer')
    )
  );

  if (shown.length === 0) {
    return [
      header,
      emptyState({
        iconName: 'signature',
        title: tab === 'open' ? 'No open offers' : 'No resolved offers',
        message:
          tab === 'open'
            ? 'Draft an offer, send it, and record the signature here. The letter is generated for you.'
            : 'Signed, declined, and withdrawn offers are kept here as a record.',
        actions: tab === 'open' ? [el('button', { class: 'btn btn-primary', onClick: () => openOfferEditor(ctx) }, icon('plus', 15), 'New offer')] : [],
      }),
    ];
  }

  return [
    header,
    el(
      'div',
      { class: 'offer-list' },
      shown.map((offer) => {
        const candidate = candidates.find((c) => c.id === offer.candidateId);
        const job = jobs.find((j) => j.id === offer.jobId);
        const expiresIn = offer.expires && offer.status === 'sent' ? daysBetween(today, offer.expires) : null;
        // Archiving keeps an open offer on the books but takes Send and
        // "Record signature" off it; without a flag the row looks exactly
        // like a live one, missing its main action for no visible reason.
        // Same rule the Interviews view applies to its own kept records.
        const archived = candidate && !isActive(candidate);
        return el(
          'div',
          { class: 'card card-pad offer-card' },
          el(
            'div',
            { class: 'offer-card-head' },
            avatar(candidate?.name),
            el(
              'div',
              { class: 'item-main' },
              el(
                'button',
                { class: 'link-button item-title', onClick: () => ctx.navigate(`candidates/${offer.candidateId}`) },
                candidate?.name ?? 'Unknown candidate'
              ),
              el('div', { class: 'item-sub' }, job?.title ?? 'Deleted job')
            ),
            archived ? badge(candidate.status === 'rejected' ? 'Rejected' : 'Withdrawn', candidate.status === 'rejected' ? 'danger' : '') : null,
            offerStatusBadge(offer.status)
          ),
          el(
            'div',
            { class: 'offer-card-terms' },
            el('span', { class: 'offer-salary tnum' }, `${formatMoney(offer.salary, offer.currency)} / year`),
            el(
              'span',
              { class: 'muted small' },
              [
                offer.bonus ? `${formatMoney(offer.bonus, offer.currency)} bonus` : null,
                offer.equity || null,
                `starts ${formatDate(offer.startDate)}`,
                offer.signedAt ? `signed ${formatTimestamp(offer.signedAt)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            )
          ),
          expiresIn !== null
            ? el(
                'div',
                { class: `offer-expiry${expiresIn <= 3 ? ' is-urgent' : ''}` },
                icon('hourglass', 13),
                expiresIn < 0 ? 'Expired. Follow up or withdraw' : expiresIn === 0 ? 'Expires today' : `Expires in ${plural(expiresIn, 'day')}`
              )
            : null,
          offerActions(ctx, offer)
        );
      })
    ),
  ];
}
