// Calendar values are untrusted message content. Keep them as text and preserve
// the sender's wall time + timezone, including custom VTIMEZONE identifiers.
// DATE end values are exclusive (RFC 5545, section 3.6.1).
const unescapeText = (value = '') => value.replace(/\\([nN,;\\])/g,
  (_, ch) => /n/i.test(ch) ? '\n' : ch);

const property = (line) => {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    if (line[i] === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const pieces = line.slice(0, colon).match(/(?:[^;"]|"[^"]*")+/g) || [];
  const name = (pieces.shift() || '').toUpperCase();
  const params = {};
  for (const piece of pieces) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    params[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1)
      .replace(/^"(.*)"$/, '$1').replace(/\^([nN^'])/g,
        (_, ch) => ch === "'" ? '"' : ch === '^' ? '^' : '\n');
  }
  return { name, params, value: line.slice(colon + 1) };
};

export const calendarDate = (prop) => {
  if (!prop) return null;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(prop.value);
  if (!match) return null;
  const [, y, m, d, h, min, s, z] = match;
  const allDay = h === undefined;
  if ((prop.params.VALUE === 'DATE' && !allDay)
    || (prop.params.VALUE === 'DATE-TIME' && allDay)) return null;
  const date = new Date(0);
  date.setUTCFullYear(+y, +m - 1, +d);
  date.setUTCHours(+(h || 0), +(min || 0), +(s || 0), 0);
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1
    || date.getUTCDate() !== +d || date.getUTCHours() !== +(h || 0)
    || date.getUTCMinutes() !== +(min || 0) || date.getUTCSeconds() !== +(s || 0)) return null;
  return { date, allDay, zone: allDay ? '' : z ? 'UTC' : prop.params.TZID || 'Local time' };
};

const person = (prop) => {
  if (!prop) return null;
  const email = /^mailto:/i.test(prop.value) ? prop.value.slice(7) : '';
  return { name: unescapeText(prop.params.CN || email || prop.value), email };
};

const duration = (value = '') => {
  const match = /^\+?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(value);
  if (!match) return null;
  const units = ['week', 'day', 'hour', 'minute', 'second'];
  const parts = match.slice(1).map((part) => Number(part || 0));
  if (!parts.some(Boolean) || parts.some((n) => !Number.isSafeInteger(n))) return null;
  return {
    days: parts.slice(2).some(Boolean) ? null : parts[0] * 7 + parts[1],
    label: parts.map((n, i) => n ? `${n} ${units[i]}${n === 1 ? '' : 's'}` : '').filter(Boolean).join(', '),
  };
};

/** Parse complete VEVENTs only; nested alarms and timezone rules are not events. */
export const parseCalendar = (source, mimeMethod = '') => {
  if (source.length > 1024 * 1024) return [];
  const stack = [];
  const events = [];
  let pending = [];
  let props = null;
  let method = mimeMethod.toUpperCase();
  for (const line of source.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    const prop = property(line);
    if (!prop) continue;
    const value = prop.value.toUpperCase();
    if (prop.name === 'BEGIN') {
      if (value === 'VCALENDAR' && stack.length === 0) {
        pending = [];
        method = mimeMethod.toUpperCase();
      }
      if (value === 'VEVENT' && stack.join('/') === 'VCALENDAR') props = [];
      stack.push(value);
    } else if (prop.name === 'END') {
      if (stack.at(-1) !== value) return events;
      if (value === 'VEVENT' && stack.join('/') === 'VCALENDAR/VEVENT' && props) {
        pending.push(props);
        props = null;
      }
      if (value === 'VCALENDAR' && stack.length === 1) {
        for (const entries of pending) {
          const get = (name) => entries.find((entry) => entry.name === name);
          const text = (name) => unescapeText(get(name)?.value);
          const start = calendarDate(get('DTSTART'));
          if (!start) continue;
          let end = calendarDate(get('DTEND'));
          const length = !get('DTEND') && duration(text('DURATION'));
          if (start.allDay && length?.days) {
            const date = new Date(start.date.getTime() + length.days * 86400000);
            if (Number.isFinite(date.getTime())) end = { ...start, date };
          }
          events.push({
            uid: text('UID'), recurrenceId: text('RECURRENCE-ID'),
            title: text('SUMMARY') || 'Untitled event', start,
            end: end && end.allDay === start.allDay
              && (end.zone !== start.zone || end.date > start.date) ? end : null,
            duration: length?.label || '',
            location: text('LOCATION'), description: text('DESCRIPTION'),
            organizer: person(get('ORGANIZER')),
            attendees: entries.filter((entry) => entry.name === 'ATTENDEE').map(person),
            cancelled: method === 'CANCEL' || text('STATUS').toUpperCase() === 'CANCELLED',
            method, recurring: Boolean(get('RRULE') || get('RDATE')),
            url: text('URL'), conference: text('X-GOOGLE-CONFERENCE'),
          });
        }
        pending = [];
      }
      stack.pop();
    } else if (stack.join('/') === 'VCALENDAR' && prop.name === 'METHOD') {
      method = value;
    } else if (stack.join('/') === 'VCALENDAR/VEVENT' && props) props.push(prop);
  }
  return events;
};

const format = (date, options) => new Intl.DateTimeFormat(undefined,
  { ...options, timeZone: 'UTC' }).format(date);
const day = (date) => format(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const time = (date) => format(date, { hour: 'numeric', minute: '2-digit' });

export const calendarWhen = ({ start, end, duration }) => {
  if (start.allDay) {
    const last = end && new Date(end.date.getTime() - 86400000);
    return `${day(start.date)}${last && last > start.date ? ` – ${day(last)}` : ''} · All day`;
  }
  const sameZone = !end || end.zone === start.zone;
  const sameDay = end && start.date.toISOString().slice(0, 10) === end.date.toISOString().slice(0, 10);
  return `${day(start.date)} · ${time(start.date)}${!sameZone ? ` (${start.zone})` : ''}`
    + (end ? ` – ${sameDay ? '' : `${day(end.date)} · `}${time(end.date)}` : '')
    + ` (${end?.zone || start.zone})${!end && duration ? ` · ${duration}` : ''}`;
};

export const calendarBadge = ({ start }) => ({
  month: format(start.date, { month: 'short' }), day: format(start.date, { day: 'numeric' }),
});
