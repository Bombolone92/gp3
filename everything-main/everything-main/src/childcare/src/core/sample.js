/**
 * A realistic sample school for the demo: rooms, children and their
 * families, staff, two weeks of attendance and activity logs (today's only
 * up to the current time), tuition plans with statements and payments,
 * conversations, events, and menus. Deterministic for a given day.
 */
import { addDays, addMonths, startOfWeek, startOfMonth, weekday, minutesToTime, pad } from './dates.js';
import { defaultSettings, mergeSettings } from './settings.js';
import { partition } from './keys.js';
import { newPin } from './people.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ava', 'Noah', 'Mia', 'Leo', 'Zoe', 'Eli', 'Nora', 'Kai', 'Ruby', 'Owen', 'Ivy', 'Milo', 'Luna', 'Theo', 'Hazel', 'Ezra', 'Maya', 'Jude', 'Aria', 'Felix', 'Lila', 'Arlo', 'Isla', 'Remy', 'Cora', 'Silas', 'June', 'Otis', 'Elena', 'Rafael', 'Amara', 'Kenji', 'Priya', 'Mateo', 'Sofia', 'Dev'];
const LAST = ['Okafor', 'Lindqvist', 'Moreno', 'Chen', 'Patel', 'Novak', 'Haddad', 'Brooks', 'Tanaka', 'Fischer', 'Alvarez', 'Kowalski', 'Nguyen', 'Mensah', 'Rossi', 'Dubois', 'Ibrahim', 'Sato', 'Larsen', 'Costa'];
const ADULT_F = ['Hannah', 'Grace', 'Laila', 'Mei', 'Anika', 'Sara', 'Olivia', 'Fatima', 'Clara', 'Yuki', 'Rosa', 'Ingrid', 'Amina', 'Elise', 'Nadia'];
const ADULT_M = ['Daniel', 'Marcus', 'Tomas', 'Wei', 'Ravi', 'Jonas', 'Samuel', 'Omar', 'Lucas', 'Kenta', 'Diego', 'Erik', 'Kwame', 'Henri', 'Pavel'];

const ROOMS = [
  { key: 'infants', name: 'Little Sprouts', ageRange: '6 weeks to 12 months', ratio: 4, capacity: 8, color: '#be185d', months: [3, 11] },
  { key: 'toddlers', name: 'Busy Bees', ageRange: '1 to 2 years', ratio: 6, capacity: 12, color: '#b45309', months: [13, 30] },
  { key: 'preschool', name: 'Explorers', ageRange: '3 to 4 years', ratio: 10, capacity: 18, color: '#0d9488', months: [36, 52] },
  { key: 'prek', name: 'Trailblazers', ageRange: '4 to 5 years', ratio: 12, capacity: 20, color: '#2563eb', months: [53, 66] },
];
const ROOM_COUNTS = { infants: 6, toddlers: 8, preschool: 10, prek: 9 };

const PLANS = [
  { id: 'plan-infant', name: 'Infant full time', amountCents: 185000, frequency: 'monthly', description: 'Monday to Friday, 7:00 to 6:00' },
  { id: 'plan-toddler', name: 'Toddler full time', amountCents: 162500, frequency: 'monthly', description: 'Monday to Friday, 7:00 to 6:00' },
  { id: 'plan-preschool', name: 'Preschool full time', amountCents: 138000, frequency: 'monthly', description: 'Monday to Friday, 7:00 to 6:00' },
  { id: 'plan-prek', name: 'Pre-K full time', amountCents: 126000, frequency: 'monthly', description: 'Monday to Friday, 7:00 to 6:00' },
  { id: 'plan-parttime', name: 'Part time (3 days)', amountCents: 26500, frequency: 'weekly', description: 'Three days a week' },
  { id: 'plan-enrichment', name: 'Music and movement', amountCents: 4500, frequency: 'monthly', description: 'Weekly enrichment class' },
];
const ROOM_PLAN = { infants: 'plan-infant', toddlers: 'plan-toddler', preschool: 'plan-preschool', prek: 'plan-prek' };

const STAFF = [
  ['Renee', 'Albright', 'Center director', null],
  ['Tomasz', 'Wiśniewski', 'Assistant director', null],
  ['Keisha', 'Morrow', 'Lead teacher', 'infants'],
  ['Lucia', 'Ferrante', 'Assistant teacher', 'infants'],
  ['Aiyana', 'Begay', 'Lead teacher', 'toddlers'],
  ['Hyun-woo', 'Park', 'Assistant teacher', 'toddlers'],
  ['Bridget', 'Callahan', 'Lead teacher', 'preschool'],
  ['Malik', 'Thompson', 'Lead teacher', 'prek'],
  ['Sunita', 'Rao', 'Floater', null],
];

const NOTES = [
  'Had a great morning in the block corner building a tall tower with friends.',
  'We read three books about autumn leaves and went on a leaf hunt outside.',
  'Practiced cutting with safety scissors today, very focused!',
  'Spent a long time at the sensory table with water and scoops.',
  'Sang songs at circle time and did all the hand motions.',
  'Helped water the classroom plants this afternoon.',
  'Painted with watercolors and was very proud of the result.',
  'Played a matching game and found every pair.',
];
const PHOTO_CAPTIONS = ['Building with blocks', 'Outdoor play', 'Art time', 'Story time', 'Sensory play', 'Snack with friends', 'Music and movement', 'Garden helpers'];
const KUDOS_NOTES = ['Shared the red truck without being asked.', 'Helped a friend zip their coat.', 'Cleaned up the art table all by themselves.', 'Kept trying on the climbing wall until they made it to the top.'];
const OBS = [
  ['Language and literacy', 'Recognizes the letters in their name', 'developing'],
  ['Math', 'Counts objects up to 10', 'proficient'],
  ['Physical', 'Hops on one foot', 'developing'],
  ['Social and emotional', 'Takes turns during group games', 'proficient'],
  ['Cognitive', 'Sorts objects by color and size', 'emerging'],
  ['Creative arts', 'Uses a variety of materials to make art', 'proficient'],
];
const MENU = {
  breakfast: ['Oatmeal with bananas', 'Whole grain waffles and berries', 'Yogurt and granola', 'Scrambled eggs and toast', 'Cereal with milk and peaches'],
  amSnack: ['Apple slices and cheese', 'Crackers and hummus', 'Orange wedges', 'Banana and milk', 'Cucumber and pita'],
  lunch: ['Chicken and rice with peas', 'Turkey sandwiches and carrots', 'Pasta with tomato sauce and broccoli', 'Bean and cheese quesadillas', 'Vegetable soup with grilled cheese'],
  pmSnack: ['Pretzels and milk', 'Berries and yogurt', 'Celery and sunflower butter', 'Graham crackers and milk', 'Melon cubes'],
};

/** A simple, flat illustration standing in for a classroom photo. */
function demoPhotoSVG(r, caption) {
  const palettes = [
    ['#f4e3c1', '#e07a5f', '#3d405b', '#81b29a', '#f2cc8f'],
    ['#dbeafe', '#2563eb', '#f59e0b', '#10b981', '#ef4444'],
    ['#fce7f3', '#db2777', '#7c3aed', '#facc15', '#14b8a6'],
    ['#ecfccb', '#65a30d', '#0ea5e9', '#f97316', '#a855f7'],
  ];
  const p = palettes[Math.floor(r() * palettes.length)];
  const shapes = [];
  for (let i = 0; i < 9; i++) {
    const x = Math.round(r() * 560 + 20);
    const y = Math.round(r() * 300 + 60);
    const s = Math.round(r() * 70 + 30);
    const c = p[1 + Math.floor(r() * 4)];
    const kind = Math.floor(r() * 3);
    if (kind === 0) shapes.push(`<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${c}"/>`);
    else if (kind === 1) shapes.push(`<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="8" fill="${c}" transform="rotate(${Math.round(r() * 40 - 20)} ${x} ${y})"/>`);
    else shapes.push(`<path d="M${x} ${y - s / 2} L${x + s / 2} ${y + s / 2} L${x - s / 2} ${y + s / 2} Z" fill="${c}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" width="640" height="440"><rect width="640" height="440" fill="${p[0]}"/><rect y="360" width="640" height="80" fill="${p[3]}" opacity=".35"/>${shapes.join('')}<text x="24" y="416" font-family="system-ui, sans-serif" font-size="26" font-weight="700" fill="${p[2]}">${caption}</text></svg>`;
}

/** A local wall-clock time on a day, as a UTC ISO timestamp. */
const iso = (day, hhmm) => {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
};

const personLabel = (g) => `${g.firstName} ${g.lastName}`;

export function buildSampleData(today, { now = new Date() } = {}) {
  const r = rng(Number(today.replace(/-/g, '')) % 100000);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const between = (a, b) => a + Math.floor(r() * (b - a + 1));
  const nowMin = today === `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` ? now.getHours() * 60 + now.getMinutes() : 24 * 60;
  let seq = 0;
  const id = (p) => `${p}${(++seq).toString(36).padStart(4, '0')}`;

  const settings = mergeSettings(defaultSettings(), {
    school: { name: 'Juniper Hill Early Learning', phone: '(541) 555-0142', email: 'hello@juniperhill.example', website: 'juniperhill.example', address: '418 Alder Street, Eugene, OR 97401', licenseNumber: 'CC-204517' },
    weekStart: 1,
    hours: { open: '07:00', close: '18:00' },
    onboarded: true,
    kioskPinHash: '',
  });

  const rooms = ROOMS.map((rm, i) => ({ id: `room-${rm.key}`, name: rm.name, ageRange: rm.ageRange, ratio: rm.ratio, capacity: rm.capacity, color: rm.color, order: i }));
  const roomByKey = Object.fromEntries(ROOMS.map((rm) => [rm.key, `room-${rm.key}`]));

  const pins = [];
  const staff = STAFF.map(([firstName, lastName, title, roomKey], i) => {
    const pin = newPin(pins);
    pins.push(pin);
    const certExp = i === 5 ? addDays(today, 12) : i === 7 ? addDays(today, -4) : addMonths(today, between(3, 20));
    return {
      id: `staff-${i + 1}`,
      firstName,
      lastName,
      title,
      email: `${firstName.toLowerCase().replace(/[^a-z]/g, '')}@juniperhill.example`,
      phone: `(541) 555-0${100 + i * 7}`,
      roomIds: roomKey ? [roomByKey[roomKey]] : [],
      hireDate: addMonths(today, -between(4, 60)),
      certifications: [
        { name: 'Pediatric CPR and First Aid', expires: certExp },
        ...(i < 3 ? [{ name: 'Early childhood education credential', expires: addMonths(today, between(8, 30)) }] : []),
      ],
      pin,
      active: true,
    };
  });

  // Children, with families. A few sibling pairs share parents.
  const students = [];
  const guardians = [];
  const usedNames = new Set();
  let fi = 0;
  const families = [];
  for (const rm of ROOMS) {
    for (let k = 0; k < ROOM_COUNTS[rm.key]; k++) {
      let first;
      do first = FIRST[fi++ % FIRST.length];
      while (usedNames.has(first) && fi < 200);
      usedNames.add(first);
      const months = between(rm.months[0], rm.months[1]);
      const bdate = addDays(addMonths(today, -months), -between(0, 27));
      const sibling = families.length > 4 && r() < 0.12 ? pick(families.slice(0, families.length - 1)) : null;
      const lastName = sibling ? sibling.lastName : pick(LAST);
      const sid = id('stu');
      const allergy = r() < 0.18 ? pick(['Peanuts', 'Tree nuts', 'Dairy', 'Eggs', 'Strawberries']) : '';
      students.push({
        id: sid,
        firstName: first,
        lastName,
        preferredName: '',
        birthday: bdate,
        gender: r() < 0.5 ? 'Girl' : 'Boy',
        status: 'active',
        roomId: roomByKey[rm.key],
        startDate: (() => {
          // Not before the room's youngest age (six weeks old).
          const start = addMonths(today, -between(2, 18));
          return start < addDays(bdate, 42) ? addDays(bdate, 42) : start;
        })(),
        allergies: allergy,
        medications: allergy === 'Peanuts' ? 'EpiPen Jr in the office cabinet' : '',
        dietary: r() < 0.08 ? 'Vegetarian' : '',
        conditions: r() < 0.06 ? 'Mild asthma, inhaler as needed' : '',
        doctor: { name: `Dr. ${pick(LAST)}`, phone: `(541) 555-0${between(300, 399)}` },
        address: `${between(100, 2999)} ${pick(['Oak', 'Willow', 'Pine', 'Cedar', 'Birch', 'Maple'])} ${pick(['Street', 'Avenue', 'Lane', 'Court'])}, Eugene, OR`,
        staffNotes: r() < 0.2 ? pick(['Settles best with a back rub at nap time.', 'Working on transitions; give a 2 minute warning.', 'Loves trucks; a good way to start the day.']) : '',
        plans: [{ planId: r() < 0.15 ? 'plan-parttime' : ROOM_PLAN[rm.key] }, ...(rm.key === 'preschool' || rm.key === 'prek' ? (r() < 0.4 ? [{ planId: 'plan-enrichment' }] : []) : [])],
        schedule: [1, 2, 3, 4, 5],
        immunizations: rm.key === 'infants' ? [{ vaccine: 'Hep B', date: bdate }, { vaccine: 'DTaP', date: addMonths(bdate, 2) }] : [{ vaccine: 'MMR', date: addMonths(bdate, 12) }, { vaccine: 'DTaP', date: addMonths(bdate, 2) }],
        photo: null,
      });
      if (sibling) {
        for (const g of guardians.filter((g) => g.familyKey === sibling.key)) g.studentIds.push(sid);
        sibling.studentIds.push(sid);
        continue;
      }
      const key = `fam${families.length}`;
      const fam = { key, lastName, studentIds: [sid] };
      families.push(fam);
      const two = r() < 0.8;
      const motherFirst = pick(ADULT_F);
      const fatherFirst = pick(ADULT_M);
      const mk = (firstName, relation, primary) => ({
        id: id('gdn'),
        familyKey: key,
        firstName,
        lastName,
        relation,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
        phone: `(541) 555-0${between(400, 899)}`,
        studentIds: [sid],
        canPickup: true,
        emergency: true,
        primary,
        billing: primary,
        pin: newPin([...pins, ...guardians.map((g) => g.pin)]),
      });
      guardians.push(mk(motherFirst, two ? 'Mother' : pick(['Mother', 'Parent']), true));
      if (two) guardians.push(mk(fatherFirst, 'Father', false));
      if (r() < 0.35) guardians.push({ ...mk(pick([...ADULT_F, ...ADULT_M]), 'Grandparent', false), lastName: pick(LAST), billing: false, emergency: true });
    }
  }
  for (const g of guardians) delete g.familyKey;

  // Waitlist and inquiries.
  for (const [first, months, status] of [['Wren', 8, 'waitlist'], ['Atlas', 20, 'waitlist'], ['Poppy', 40, 'inquiry']]) {
    const lastName = pick(LAST);
    const sid = id('stu');
    students.push({
      id: sid,
      firstName: first,
      lastName,
      birthday: addMonths(today, -months),
      status,
      roomId: months < 12 ? roomByKey.infants : months < 31 ? roomByKey.toddlers : roomByKey.preschool,
      inquiry: { firstContact: addDays(today, -between(10, 60)), toured: status === 'waitlist' ? addDays(today, -between(3, 9)) : '', desiredStart: addMonths(today, between(1, 4)), source: pick(['Referral', 'Website', 'Drive by']), notes: '' },
      plans: [],
      schedule: [1, 2, 3, 4, 5],
    });
    guardians.push({ id: id('gdn'), firstName: pick(ADULT_F), lastName, relation: 'Mother', email: `${first.toLowerCase()}.family@example.com`, phone: `(541) 555-0${between(400, 899)}`, studentIds: [sid], canPickup: true, emergency: true, primary: true, billing: true });
  }

  const active = students.filter((s) => s.status === 'active');
  const guardiansOf = (sid) => guardians.filter((g) => g.studentIds.includes(sid));

  // School days: the last two weeks of weekdays plus today.
  const days = [];
  for (let d = addDays(today, -15); d <= today; d = addDays(d, 1)) if (weekday(d) !== 0 && weekday(d) !== 6) days.push(d);

  const collections = {
    rooms,
    staff,
    students,
    guardians,
    plans: PLANS,
    events: [],
    menus: [],
    invoices: [],
    payments: [],
    announcements: [],
    threads: [],
  };
  const files = [];
  const put = (name, rec) => (collections[name] ||= []).push(rec);

  // ---- Attendance and activities -----------------------------------------
  const roomStaff = Object.fromEntries(rooms.map((rm) => [rm.id, staff.filter((s) => s.roomIds.includes(rm.id))]));
  for (const day of days) {
    const isToday = day === today;
    const att = partition('attendance', day);
    const act = partition('activities', day);
    // Staff clock in first.
    for (const m of staff) {
      if (r() < 0.06 && !isToday) continue;
      const inMin = between(6 * 60 + 40, 8 * 60 + 30);
      if (isToday && inMin > nowMin) continue;
      const outMin = between(15 * 60, 18 * 60 + 5);
      const roomId = m.roomIds[0] || pick(rooms).id;
      const events = [{ type: 'in', at: minutesToTime(inMin), roomId, by: 'Kiosk' }];
      if (!isToday || outMin <= nowMin) events.push({ type: 'out', at: minutesToTime(outMin), roomId, by: 'Kiosk' });
      put(att, { id: `t-${m.id}`, kind: 'staff', staffId: m.id, roomId, events, createdAt: iso(day, '07:00'), updatedAt: iso(day, '07:00') });
    }
    for (const s of active) {
      const rr = r();
      const fam = guardiansOf(s.id);
      if (rr < 0.07) {
        put(att, { id: `s-${s.id}`, kind: 'student', studentId: s.id, roomId: s.roomId, events: [], absent: { reason: pick(['Sick', 'Vacation', 'Appointment']), by: fam[0] ? `${fam[0].firstName} ${fam[0].lastName}` : '', at: '07:10', byFamily: true }, createdAt: iso(day, '07:10'), updatedAt: iso(day, '07:10') });
        continue;
      }
      const inMin = between(7 * 60 + 5, 9 * 60 + 15);
      if (isToday && inMin > nowMin) continue;
      const outMin = between(15 * 60 + 15, 17 * 60 + 50);
      const dropper = pick(fam) || null;
      const events = [{ type: 'in', at: minutesToTime(inMin), roomId: s.roomId, by: pick(roomStaff[s.roomId] || staff).firstName, person: dropper ? personLabel(dropper) : '' }];
      if (!isToday || outMin <= nowMin) events.push({ type: 'out', at: minutesToTime(outMin), roomId: s.roomId, by: pick(roomStaff[s.roomId] || staff).firstName, person: dropper ? personLabel(pick(fam)) : '' });
      put(att, { id: `s-${s.id}`, kind: 'student', studentId: s.id, roomId: s.roomId, events, absent: null, createdAt: iso(day, minutesToTime(inMin)), updatedAt: iso(day, minutesToTime(inMin)) });

      // Activities through the day.
      const teacher = pick(roomStaff[s.roomId]?.length ? roomStaff[s.roomId] : staff);
      const by = `${teacher.firstName} ${teacher.lastName}`;
      const room = rooms.find((x) => x.id === s.roomId);
      const infant = room.id === roomByKey.infants;
      const small = infant || room.id === roomByKey.toddlers;
      const log = (atMin, type, details = {}, extra = {}) => {
        if (atMin < inMin || atMin > outMin || (isToday && atMin > nowMin)) return;
        const at = minutesToTime(atMin);
        put(act, { id: id('act'), type, studentId: s.id, roomId: s.roomId, day, at, details, by, byId: teacher.id, ...extra, createdAt: iso(day, at), updatedAt: iso(day, at) });
      };
      if (infant) {
        for (const t of [8 * 60 + 30, 11 * 60, 13 * 60 + 30, 16 * 60]) log(t + between(-15, 15), 'meal', { kind: 'bottle', amount: String(between(3, 6)), unit: 'oz', contents: pick(['Formula', 'Breast milk']) });
        // A nap that ends after now today is still going.
        const nap = (atMin, start, endMin) => log(atMin, 'nap', isToday && endMin > nowMin ? { start } : { start, end: minutesToTime(endMin) });
        nap(between(9 * 60 + 30, 10 * 60), '09:40', (10 + between(0, 1)) * 60 + between(10, 50));
        nap(between(13 * 60, 13 * 60 + 20), '13:00', 14 * 60 + between(10, 55));
      } else {
        log(between(8 * 60, 8 * 60 + 25), 'meal', { kind: 'food', meal: 'Breakfast', amount: pick(['all', 'most', 'some']), items: pick(MENU.breakfast) });
        log(between(11 * 60 + 30, 11 * 60 + 50), 'meal', { kind: 'food', meal: 'Lunch', amount: pick(['all', 'most', 'most', 'some', 'none']), items: pick(MENU.lunch) });
        log(between(15 * 60, 15 * 60 + 20), 'meal', { kind: 'food', meal: 'PM snack', amount: pick(['all', 'most']), items: pick(MENU.pmSnack) });
        const napStart = between(12 * 60 + 25, 12 * 60 + 45);
        const napEnd = napStart + between(50, 120);
        if (!isToday || napEnd <= nowMin) log(napStart, 'nap', { start: minutesToTime(napStart), end: minutesToTime(napEnd) });
        else log(napStart, 'nap', { start: minutesToTime(napStart) });
      }
      if (small) for (const t of [9 * 60 + 45, 12 * 60 + 15, 15 * 60 + 30]) log(t + between(-10, 10), 'toilet', { kind: infant || r() < 0.6 ? 'diaper' : 'potty', wet: true, bm: r() < 0.3 || undefined });
      else if (r() < 0.4) log(between(10 * 60, 14 * 60), 'toilet', { kind: 'potty', wet: true });
      if (r() < 0.5) log(between(9 * 60 + 45, 10 * 60 + 45), 'note', {}, { note: pick(NOTES) });
      if (r() < 0.22) log(between(10 * 60, 16 * 60), 'kudos', { category: pick(['Kindness', 'Sharing', 'Helping', 'Persistence']) }, { note: pick(KUDOS_NOTES) });
      if (!infant && r() < 0.18) {
        const [domain, skill, level] = pick(OBS);
        log(between(9 * 60 + 30, 15 * 60), 'observation', { domain, skill, level }, { note: 'Observed during center time.', staffOnly: r() < 0.3 || undefined });
      }
      if (r() < 0.12) log(between(8 * 60 + 15, 16 * 60), 'mood', { mood: pick(['happy', 'calm', 'energetic', 'tired']) });
    }

    // Group photos: one or two per room per day, shared by several children.
    for (const room of rooms) {
      const count = between(0, 2);
      for (let k = 0; k < count; k++) {
        const atMin = between(9 * 60 + 30, 15 * 60 + 40);
        if (isToday && atMin > nowMin) continue;
        const kids = active.filter((s) => s.roomId === room.id && r() < 0.45).slice(0, 5);
        if (!kids.length) continue;
        const caption = pick(PHOTO_CAPTIONS);
        const fileId = id('img');
        const path = `media/${day.slice(0, 7)}/${fileId}-photo.svg`;
        files.push({ path, svg: demoPhotoSVG(r, caption) });
        const media = [{ id: fileId, name: `${caption}.svg`, type: 'image/svg+xml', size: 4000, path, w: 640, h: 440 }];
        const at = minutesToTime(atMin);
        const teacher = pick(roomStaff[room.id]?.length ? roomStaff[room.id] : staff);
        const groupId = id('grp');
        for (const s of kids) put(partition('activities', day), { id: id('act'), type: 'photo', studentId: s.id, roomId: room.id, day, at, note: `${caption} in ${room.name}`, media, by: `${teacher.firstName} ${teacher.lastName}`, byId: teacher.id, groupId, createdAt: iso(day, at), updatedAt: iso(day, at) });
      }
    }
  }

  // A small incident earlier this week, shared with the family.
  const incidentKid = active.find((s) => s.roomId === roomByKey.toddlers);
  if (incidentKid && days.length > 2) {
    const day = days[days.length - 3];
    put(partition('activities', day), { id: id('act'), type: 'incident', studentId: incidentKid.id, roomId: incidentKid.roomId, day, at: '10:20', details: { kind: 'Bump or bruise', location: 'Playground', action: 'Cold pack applied for 5 minutes; comforted and returned to play.', notified: 'Phone call to parent' }, note: 'Slipped near the slide and bumped their knee. No broken skin.', by: 'Aiyana Begay', byId: 'staff-5', createdAt: iso(day, '10:20'), updatedAt: iso(day, '10:20') });
  }

  // ---- Billing: two months of statements ---------------------------------
  let invNo = 1001;
  const months = [startOfMonth(addMonths(today, -1)), startOfMonth(today)];
  for (const s of active) {
    for (const m of months) {
      const items = s.plans
        .map((sp) => PLANS.find((p) => p.id === sp.planId))
        .filter(Boolean)
        .map((p) => ({ id: id('li'), description: `${p.name}, ${new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}`, amountCents: p.frequency === 'weekly' ? p.amountCents * 4 : p.amountCents, qty: 1 }));
      if (!items.length) continue;
      const due = addDays(m, 5);
      const inv = { id: id('inv'), number: invNo++, studentId: s.id, issueDate: addDays(m, -3), dueDate: due, period: `monthly:${m.slice(0, 7)}`, items, status: 'open', createdAt: iso(m, '09:00'), updatedAt: iso(m, '09:00') };
      collections.invoices.push(inv);
      const total = items.reduce((a, it) => a + it.amountCents, 0);
      const current = m === months[1];
      const roll = r();
      // Most families pay on time; a few are late or partial.
      if (!current || (due <= today && roll < 0.92)) {
        if (roll < 0.04 && !current) continue;
        const amount = roll > 0.92 ? Math.round(total / 2) : total;
        collections.payments.push({ id: id('pay'), studentId: s.id, amountCents: amount, date: addDays(due, -between(0, 6)), method: pick(['card', 'bank', 'bank', 'check']), reference: roll > 0.5 ? `#${between(1000, 9999)}` : '', kind: 'payment', createdAt: iso(due, '12:00'), updatedAt: iso(due, '12:00') });
      }
    }
  }
  const subsidyKid = active[3];
  if (subsidyKid) collections.payments.push({ id: id('pay'), studentId: subsidyKid.id, amountCents: 40000, date: addDays(today, -9), method: 'subsidy', reference: 'State childcare assistance', kind: 'payment', createdAt: iso(addDays(today, -9), '12:00'), updatedAt: iso(addDays(today, -9), '12:00') });
  settings.numbering.invoice = invNo;

  // ---- Calendar, menus, announcements ------------------------------------
  const ev = (title, date, extra = {}) => collections.events.push({ id: id('evt'), title, date, allDay: true, kind: 'event', roomIds: [], ...extra });
  ev('Picture day', addDays(today, 3), { description: 'Portraits in the morning. Class photos at 10:30.' });
  ev('Pumpkin patch field trip', addDays(today, 9), { roomIds: [roomByKey.preschool, roomByKey.prek], allDay: false, start: '09:30', end: '12:00', description: 'Permission slips due Friday. Please pack boots.' });
  ev('Family conferences', addDays(today, 16), { description: 'Sign up for a 20 minute slot with your child\'s teacher.' });
  ev('Closed: staff training day', addDays(today, 23), { kind: 'closure' });
  ev('Fire drill', addDays(today, -2), { allDay: false, start: '10:00', end: '10:15', description: 'Practice drill; all classrooms.' });
  // The fourth Thursday of November, this year or next.
  const thanksgiving = (year) => {
    const nov = `${year}-11-01`;
    return addDays(nov, ((4 - weekday(nov) + 7) % 7) + 21);
  };
  const year = Number(today.slice(0, 4));
  ev('Closed: Thanksgiving', thanksgiving(year) < today ? thanksgiving(year + 1) : thanksgiving(year), { kind: 'closure' });

  for (const w of [startOfWeek(today, 1), addDays(startOfWeek(today, 1), 7)]) {
    const daysOut = {};
    for (let i = 0; i < 5; i++) daysOut[i + 1] = { breakfast: MENU.breakfast[(i + (w > today ? 2 : 0)) % 5], amSnack: MENU.amSnack[(i + 1) % 5], lunch: MENU.lunch[(i + (w > today ? 3 : 0)) % 5], pmSnack: MENU.pmSnack[(i + 2) % 5] };
    collections.menus.push({ id: w, weekStart: w, days: daysOut, notes: 'Milk served with every meal. Alternatives are available for allergies.' });
  }

  collections.announcements.push(
    { id: id('ann'), title: 'Picture day is this week', body: 'Our photographer visits on picture day. Portraits start at 8:30, so please plan to arrive on time. Order forms are in your cubby.', roomIds: [], author: 'Renee Albright', at: iso(addDays(today, -1), '16:05'), pinned: true },
    { id: id('ann'), title: 'Cold weather reminder', body: 'We play outside every day unless it is below freezing. Please send a warm coat, hat, and mittens labeled with your child\'s name.', roomIds: [], author: 'Renee Albright', at: iso(addDays(today, -4), '15:30') },
    { id: id('ann'), title: 'Explorers: bring a leaf', body: 'We are making a leaf collage next week. Please help your child pick one interesting leaf from your yard or a walk.', roomIds: [roomByKey.preschool], author: 'Bridget Callahan', at: iso(addDays(today, -2), '14:10') },
  );

  // ---- Conversations ----------------------------------------------------
  const convos = [
    [['family', 'Good morning! She did not sleep well last night, so she may be tired today.'], ['staff', 'Thanks for letting us know. We will offer an early nap if she seems sleepy.'], ['staff', 'She napped for almost two hours and woke up happy.']],
    [['staff', 'Just a heads up, we are running low on diapers in his cubby. Could you bring a pack tomorrow?'], ['family', 'Will do, thank you!']],
    [['family', 'Grandma will pick up today around 4:30.'], ['staff', 'Got it. She is on the pickup list, so we are all set.']],
    [['staff', 'He was so proud of his painting today. It is drying on the art wall for you to see at pickup.']],
    [['family', 'Is the field trip permission slip due this week?'], ['staff', 'Yes, by Friday please. There are extra copies by the sign-in table.'], ['family', 'Perfect, I will grab one.']],
  ];
  convos.forEach((msgs, i) => {
    const s = active[(i * 7 + 2) % active.length];
    const fam = guardiansOf(s.id)[0];
    const teacher = roomStaff[s.roomId]?.[0] || staff[0];
    let at = null;
    const name = partition('messages', s.id);
    msgs.forEach(([from, text], k) => {
      const day = addDays(today, -(msgs.length - k) + (i % 2 ? 0 : -1));
      const t = `${pad(8 + k * 2 + (i % 3))}:${pad((i * 13 + k * 7) % 60)}`;
      at = iso(day, t);
      put(name, { id: id('msg'), studentId: s.id, at, from, author: from === 'staff' ? `${teacher.firstName} ${teacher.lastName}` : `${fam.firstName} ${fam.lastName}`, text, createdAt: at, updatedAt: at });
    });
    const last = msgs[msgs.length - 1];
    collections.threads.push({ id: s.id, lastAt: at, lastText: last[1].slice(0, 140), lastFrom: last[0], lastAuthor: last[0] === 'staff' ? `${teacher.firstName} ${teacher.lastName}` : `${fam.firstName} ${fam.lastName}`, staffReadAt: i === 4 ? null : at, familyReadAt: {} });
  });

  // The family the demo previews: one with a conversation and a photo-rich day.
  const demoFamily = guardians.find((g) => g.studentIds.includes(active[(4 * 7 + 2) % active.length].id) && g.primary) || guardians[0];

  return { settings, collections, files, demoFamily: { guardianId: demoFamily.id, studentIds: demoFamily.studentIds } };
}

