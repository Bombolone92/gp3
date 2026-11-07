import { el } from './dom.js';
import { icon } from './icons.js';
import { calendarBadge, calendarWhen } from '../lib/calendar.js';

const safeLink = (value) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};

export const calendarCard = (event, onDownload) => {
  const badge = calendarBadge(event);
  const row = (label, content) => content && [el('dt', {}, label), el('dd', {}, content)];
  const person = (p) => p.email && p.name !== p.email ? `${p.name} <${p.email}>` : p.name;
  const conference = safeLink(event.conference);
  const url = safeLink(event.url);
  const link = (href, label) => el('a.btn', {
    href, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer',
  }, label, el('span', { html: icon('link', 14) }));
  return el(`section.calendar-invite${event.cancelled ? '.is-cancelled' : ''}`, {
    'aria-label': `${event.cancelled ? 'Cancelled event' : 'Calendar invitation'}: ${event.title}`,
  },
    el('div.calendar-badge', { 'aria-hidden': 'true' },
      el('span.calendar-month', {}, badge.month), el('span.calendar-day', {}, badge.day)),
    el('div.calendar-content', {},
      el('div.calendar-status', {}, event.cancelled ? 'Event cancelled'
        : event.method === 'REPLY' ? 'Invitation response' : 'Calendar invitation'),
      el('h3.calendar-title', {}, event.title),
      el('p.calendar-when', {}, calendarWhen(event)),
      event.recurring && el('p.calendar-repeat', {}, 'Repeating event'),
      el('dl.calendar-details', {},
        row('Where', event.location),
        row('Organizer', event.organizer && person(event.organizer)),
        row('Guests', event.attendees.length && el('details.calendar-guests', {},
          el('summary', {}, `${event.attendees.length} guest${event.attendees.length === 1 ? '' : 's'}`),
          el('ul', {}, event.attendees.map((p) => el('li', {}, person(p))))))),
      event.description && el('details.calendar-description', {},
        el('summary', {}, 'Event description'), el('p', {}, event.description)),
      el('div.calendar-actions', {},
        !event.cancelled && conference && link(conference, 'Join meeting'),
        !event.cancelled && url && url !== conference && link(url, 'Event details'),
        el('button.btn', { type: 'button', onclick: () => onDownload(event.file) },
          el('span', { html: icon('download', 15) }), 'Download invite'))));
};
