// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { setupStore, settle, byText } from './review2-checkin-env.js';
import { app } from '../src/app.js';
import { activityName } from '../src/core/activities.js';
import { addDays } from '../src/core/dates.js';

const seed = () => ({
  rooms: [{ id: 'r1', name: 'Bees', ratio: 4 }],
  students: [
    { id: 's1', firstName: 'Ava', lastName: 'Chen', status: 'active', roomId: 'r1' },
    { id: 's2', firstName: 'Ben', lastName: 'Ode', status: 'active', roomId: 'r1' },
  ],
});

const dialog = () => [...document.querySelectorAll('dialog[open]')].at(-1);
const setValue = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const submit = () => dialog().querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));

afterEach(() => document.querySelectorAll('dialog').forEach((d) => d.remove()));

describe('log activity', () => {
  it('medication "given at" follows the time entered, not when the form was opened', async () => {
    const store = await setupStore(seed());
    const { openLogActivity } = await import('../src/views/log.js');
    const done = openLogActivity({ type: 'meds', studentIds: ['s1'] });
    setValue(dialog().querySelector('input[placeholder="Name"]'), 'Ibuprofen');
    setValue(dialog().querySelector('input[name=at]'), '09:15');
    submit();
    const [rec] = await done;
    expect(rec.at).toBe('09:15');
    expect(rec.details.time).toBe('09:15');

    const edited = openLogActivity({ edit: rec });
    setValue(dialog().querySelector('input[name=at]'), '09:45');
    submit();
    const [after] = await edited;
    expect(store.get(activityName(rec.day), after.id).details.time).toBe('09:45');
  });

  it('children with no room, or a deleted room, can be chosen', async () => {
    const data = seed();
    data.students.push({ id: 's3', firstName: 'Cleo', lastName: 'Ray', status: 'active' }, { id: 's4', firstName: 'Dev', lastName: 'Ng', status: 'active', roomId: 'gone' });
    await setupStore(data);
    const { pickChildren } = await import('../src/views/log.js');
    const picked = pickChildren({ onlyIn: false });
    await settle();
    const names = [...dialog().querySelectorAll('.pick-name')].map((n) => n.textContent);
    expect(names).toEqual(expect.arrayContaining(['Cleo Ray', 'Dev Ng']));
    byText(dialog(), 'label.pick-card', 'Cleo').querySelector('input').click();
    byText(dialog(), '.dialog-foot button', 'Done').click();
    expect(await picked).toEqual(['s3']);
  });

  it('choosing a mood keeps focus on the chosen chip', async () => {
    await setupStore(seed());
    const { openLogActivity } = await import('../src/views/log.js');
    const done = openLogActivity({ type: 'mood', studentIds: ['s1'] });
    const happy = byText(dialog(), '.choice-chips button', 'Happy');
    happy.focus();
    happy.click();
    expect(document.activeElement).toBe(happy);
    expect(happy.getAttribute('aria-checked')).toBe('true');
    const calm = byText(dialog(), '.choice-chips button', 'Calm');
    calm.click();
    expect(happy.getAttribute('aria-checked')).toBe('false');
    submit();
    const [rec] = await done;
    expect(rec.details.mood).toBe('calm');
  });

  it('switching a meal between bottle and food does not keep the other kind\'s amount', async () => {
    await setupStore(seed());
    const { openLogActivity } = await import('../src/views/log.js');
    const { describe: describeEntry } = await import('../src/core/activities.js');
    const done = openLogActivity({ type: 'meal', studentIds: ['s1'] });
    byText(dialog(), '.seg button', 'Bottle').click();
    setValue(dialog().querySelector('input[type=number]'), '4');
    byText(dialog(), '.seg button', 'Food').click();
    submit();
    const [rec] = await done;
    expect(rec.details.kind).toBe('food');
    expect(rec.details.amount).toBeUndefined();
    expect(rec.details.unit).toBeUndefined();
    expect(describeEntry(rec)).not.toMatch(/Ate(\s|$)·?/);

    const again = openLogActivity({ type: 'meal', studentIds: ['s1'] });
    byText(dialog(), '.seg button', 'Most').click();
    byText(dialog(), '.seg button', 'Bottle').click();
    submit();
    const [bottle] = await again;
    expect(bottle.details.amount).toBeUndefined();
  });

  it('an entry needs a time and a date that is not in the future', async () => {
    const store = await setupStore(seed());
    const { openLogActivity } = await import('../src/views/log.js');
    openLogActivity({ type: 'note', studentIds: ['s1'] });
    setValue(dialog().querySelector('input[name=at]'), '');
    submit();
    await settle();
    expect(store.all(activityName(app.today()))).toHaveLength(0);
    expect(dialog()).toBeTruthy();
    setValue(dialog().querySelector('input[name=at]'), '10:00');
    setValue(dialog().querySelector('input[name=day]'), addDays(app.today(), 1));
    submit();
    await settle();
    expect(store.all(activityName(addDays(app.today(), 1)))).toHaveLength(0);
    setValue(dialog().querySelector('input[name=day]'), app.today());
    submit();
    await settle();
    expect(store.all(activityName(app.today()))).toHaveLength(1);
  });
});
