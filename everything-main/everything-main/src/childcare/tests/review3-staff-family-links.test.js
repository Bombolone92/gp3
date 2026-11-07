// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootViews, app, tick } from './review2-people-harness.js';

// Only the director or an admin can change which children a family member
// who uses the app sees: staff get the list read-only instead of a save the
// school server will not apply.
describe('staff and a signed-up family member', () => {
  let g;
  beforeAll(async () => {
    await bootViews();
    const { personName } = await import('../src/core/format.js');
    const all = app.store.all('guardians');
    g = all.find((x) => (x.studentIds || []).length && !x.pickupOnly && all.filter((y) => personName(y) === personName(x)).length === 1);
    app.store.patch('guardians', g.id, { memberUuid: 'user-3' });
    app.demo = false;
    app.team = { url: 'https://school.puter.work', role: 'staff', school: 'School' };
  });
  afterAll(() => {
    app.demo = true;
    app.team = null;
    document.querySelectorAll('dialog').forEach((d) => d.remove());
  });

  it('shows their children read-only and no Remove button', async () => {
    const { openGuardianForm } = await import('../src/views/families.js');
    openGuardianForm({ guardian: app.store.get('guardians', g.id) });
    await tick(20);
    const dialog = [...document.querySelectorAll('dialog')].pop();
    const boxes = [...dialog.querySelectorAll('.kid-check-list input[type=checkbox]')];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect([...dialog.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Remove')).toBe(false);
    dialog.remove();
  });

  it('leaves them out of "link a family member"', async () => {
    const { linkExisting } = await import('../src/views/families.js');
    const child = app.store.all('students').find((s) => !g.studentIds.includes(s.id));
    linkExisting(child);
    await tick(20);
    const dialog = [...document.querySelectorAll('dialog')].pop();
    const { personName } = await import('../src/core/format.js');
    const search = dialog.querySelector('input');
    search.value = personName(g);
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(250);
    const names = [...dialog.querySelectorAll('.link-list .title')].map((n) => n.textContent);
    expect(names).not.toContain(personName(g));
    // Without the app, a family member can still be linked by staff.
    app.store.patch('guardians', g.id, { memberUuid: null });
    dialog.remove();
    linkExisting(child);
    await tick(20);
    const again = [...document.querySelectorAll('dialog')].pop();
    const s2 = again.querySelector('input');
    s2.value = personName(g);
    s2.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(250);
    expect([...again.querySelectorAll('.link-list .title')].map((n) => n.textContent)).toContain(personName(g));
    app.store.patch('guardians', g.id, { memberUuid: 'user-3' });
    again.remove();
    dialog.remove();
  });
});
