import { describe, expect, it } from 'vitest';
import { templateById } from '../src/core/templates.js';
import { todaySerial, formatDate } from '../src/core/format.js';

// The summary's Open, Overdue and Due this week counted tasks whose Done cell held FALSE, so a task typed under
// the table or added with Tab, whose Done cell is blank until its checkbox is clicked, was not counted anywhere
// (COUNTIFS(...,FALSE) does not match a blank): seven tasks, six unticked, Open 5.
describe('the To-do template summary', () => {
  const build = () => { const wb = templateById('todo').build(); return { wb, id: wb.sheets[0].id }; };
  const open = (wb, id) => wb.getValue(id, 1, 7);
  const done = (wb, id) => wb.getValue(id, 2, 7);
  const overdue = (wb, id) => wb.getValue(id, 3, 7);
  const thisWeek = (wb, id) => wb.getValue(id, 4, 7);

  it('counts a task typed under the table as open while its checkbox is blank', () => {
    const { wb, id } = build();
    expect([open(wb, id), done(wb, id)]).toEqual([5, 1]);
    wb.setInput(id, 7, 1, 'New task');
    expect(wb.tablesOn(id)[0].range.r2).toBe(7);
    expect(wb.getCell(id, 7, 0)).toBeFalsy();
    expect([open(wb, id), done(wb, id)]).toEqual([6, 1]);
    // Ticked, it moves to Done; unticked again (FALSE, as the checkbox writes it), back to Open.
    wb.setInput(id, 7, 0, 'TRUE');
    expect([open(wb, id), done(wb, id)]).toEqual([5, 2]);
    wb.setInput(id, 7, 0, 'FALSE');
    expect([open(wb, id), done(wb, id)]).toEqual([6, 1]);
  });

  it('counts a task added with Tab from the last cell as open', () => {
    const { wb, id } = build();
    const table = wb.tablesOn(id)[0];
    expect(wb.addTableRow(id, table.id)).toBe(7);
    wb.setInput(id, 7, 1, 'Another task');
    expect(open(wb, id)).toBe(6);
  });

  it('counts a blank-checkbox task among the overdue and the due this week by its date', () => {
    const { wb, id } = build();
    const before = [overdue(wb, id), thisWeek(wb, id)];
    const today = todaySerial();
    wb.setInput(id, 7, 1, 'Late task');
    wb.setInput(id, 7, 2, formatDate(today - 2));
    expect([overdue(wb, id), thisWeek(wb, id)]).toEqual([before[0] + 1, before[1]]);
    wb.setInput(id, 8, 1, 'Soon task');
    wb.setInput(id, 8, 2, formatDate(today + 3));
    expect([overdue(wb, id), thisWeek(wb, id)]).toEqual([before[0] + 1, before[1] + 1]);
    // A blank due date is neither.
    wb.setInput(id, 9, 1, 'Undated task');
    expect([overdue(wb, id), thisWeek(wb, id)]).toEqual([before[0] + 1, before[1] + 1]);
    expect(open(wb, id)).toBe(8);
  });
});
