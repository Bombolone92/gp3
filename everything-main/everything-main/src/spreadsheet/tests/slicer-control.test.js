import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { createSlicerControl } from '../src/ui/slicer.js';
import { slicerItems, setSlicerSelection } from '../src/core/slicer.js';
const model = { title: 'Category', w: 320, h: 150, rowHeight: 24 * 9525, columnCount: 2, startItem: 0, showCaption: true };
const data = ['Alpha', 'Beta', '', '<script>'].map(value => ({ value, selected: true, available: true }));
function make(change = () => true) {
  const dom = new JSDOM('<body/>'), doc = dom.window.document, control = createSlicerControl(doc, change);
  doc.body.append(control.node); control.update(model, data);
  const item = value => [...control.node.querySelectorAll('.slicer-item')].find(n => n.slicerItem.value === value);
  return { dom, doc, control, item };
}
it('renders safe native buttons, labels, dimensions, selection and unavailable descriptions', () => {
  const { control, item } = make();
  expect(item('').textContent).toBe('(Blank)'); expect(control.node.querySelector('script')).toBeNull();
  expect(item('Alpha').getAttribute('aria-pressed')).toBe('true');
  expect(item('Alpha').style.height).toBe('24px');
  control.update(model, data.map(i => ({ ...i, available: false })));
  expect(item('Alpha').disabled).toBe(false); expect(item('Alpha').getAttribute('aria-description')).toContain('No matching data');
});
it('commits single, modifier, range and clear choices without optimistic selection changes', () => {
  const changes = [], { dom, control, item } = make(v => { changes.push(v); return false; });
  item('Beta').click(); expect(changes.pop()).toEqual(['Beta']); expect(item('Beta').getAttribute('aria-pressed')).toBe('true');
  item('Beta').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
  expect(changes.pop()).toEqual(['Alpha', '', '<script>']);
  control.update(model, data.map(i => ({ ...i, selected: i.value === 'Beta' })));
  control.node.querySelector('[aria-label="Clear filter"]').click(); expect(changes.pop()).toBeNull();
});
it('navigates two-dimensional items by keyboard, activates once and preserves focus across updates', () => {
  const changes = [], { dom, doc, control, item } = make(v => changes.push(v));
  item('Alpha').focus();
  const key = k => doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key('ArrowDown'); expect(doc.activeElement).toBe(item(''));
  key('ArrowRight'); expect(doc.activeElement).toBe(item('<script>'));
  key('Home'); expect(doc.activeElement).toBe(item('Alpha'));
  key('End'); key(' '); expect(changes).toEqual([['<script>']]);
  const before = doc.activeElement;
  control.update(model, data.map(i => ({ ...i, selected: i.value === '<script>' })));
  expect(doc.activeElement).toBe(before);
  control.update(model, [...data].reverse()); expect(doc.activeElement).toBe(before);
  expect([...control.node.querySelectorAll('.slicer-item')].filter(n => n.tabIndex === 0)).toEqual([before]);
});
it('supports explicit multi-select mode and range selection', () => {
  const changes = [], { dom, control, item } = make(v => changes.push(v));
  item('Beta').click();
  control.update(model, data.map(i => ({ ...i, selected: i.value === 'Beta' })));
  item('<script>').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  expect(changes.at(-1)).toEqual(['Beta', '', '<script>']);
  control.node.querySelector('[aria-label="Multi-select"]').click();
  item('Alpha').click(); expect(changes.at(-1)).toEqual(['Alpha', 'Beta']);
});
it('does not allow disabled or read-only actions and reports missing bindings', () => {
  const changes = [], { control, item } = make(v => changes.push(v));
  control.update(model, data, {}, { disabled: true }); item('Alpha').click(); expect(changes).toEqual([]);
  control.update(model, null); expect(control.node.textContent).toContain('linked table column is unavailable');
  expect(control.node.querySelectorAll('.slicer-item')).toHaveLength(0);
  control.update({ ...model, hidden: true }, data); expect(control.node.style.display).toBe('none');
});
it('keeps scroll position on data updates and responds to explicit start-item changes', () => {
  const { control } = make(); const list = control.node.querySelector('.slicer-items');
  const long = Array.from({ length: 40 }, (_, i) => ({ value: String(i), selected: true, available: true }));
  control.update(model, long);
  list.scrollTop = 17; control.update(model, long); expect(list.scrollTop).toBe(17);
  control.update({ ...model, startItem: 2, showCaption: false }, long);
  expect(list.scrollTop).toBe(26); expect(control.node.querySelector('.slicer-header').style.display).toBe('none');
});
it('applies hover paint, restores normal paint, and isolates pointer gestures from sheet dragging', () => {
  const { dom, control, item } = make();
  control.update(model, data, { items: { selectedItemWithData: { bg: '#ff0000' }, hoveredSelectedItemWithData: { bg: '#0000ff' } } });
  item('Alpha').dispatchEvent(new dom.window.Event('pointerenter')); expect(item('Alpha').style.backgroundColor).toBe('rgb(0, 0, 255)');
  item('Alpha').dispatchEvent(new dom.window.Event('pointerleave')); expect(item('Alpha').style.backgroundColor).toBe('rgb(255, 0, 0)');
  let drag = false; control.node.parentElement.addEventListener('pointerdown', () => { drag = true; });
  item('Alpha').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); expect(drag).toBe(false);
});
it('filters a real workbook and restores item state on undo without losing focus', () => {
  const wb = new Workbook(), s = wb.activeSheet;
  ['Category', 'Alpha', 'Beta'].forEach((v, r) => wb.setInput(s.id, r, 0, v));
  wb.addTable(s.id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Orders' });
  const id = wb.addChart(s.id, { ...model, type: 'slicer', anchor: { r: 4, c: 0 }, tableRef: 'Orders[Category]' });
  const { control, doc, item } = make(values => { const ok = setSlicerSelection(wb, s.id, id, values); refresh(); return ok; });
  const refresh = () => control.update(wb.chartById(s.id, id), slicerItems(wb, wb.chartById(s.id, id)));
  refresh(); item('Beta').focus(); item('Beta').click(); expect([...s.filterHidden]).toEqual([1]);
  const focused = doc.activeElement; wb.undo(); refresh(); expect([...s.filterHidden]).toEqual([]);
  expect(doc.activeElement).toBe(focused); expect(item('Alpha').getAttribute('aria-pressed')).toBe('true');
});

it('does not steal focus from another slicer and recovers focus when its own item disappears', () => {
  const { doc, control, item } = make();
  const second = createSlicerControl(doc, () => true); doc.body.append(second.node); second.update(model, data);
  const other = second.node.querySelector('.slicer-item'); other.focus();
  control.update(model, [...data].reverse()); expect(doc.activeElement).toBe(other);
  item('Beta').focus(); control.update(model, data.filter(i => i.value !== 'Beta'));
  expect(control.node.contains(doc.activeElement)).toBe(true); expect(doc.activeElement.className).toBe('slicer-item');
  control.update(model, []); expect(doc.activeElement).toBe(control.node);
});

it('bounds large lists to the viewport while keyboard navigation reaches every value', () => {
  const changes = [], { dom, doc, control } = make(v => changes.push(v));
  const large = Array.from({ length: 20000 }, (_, i) => ({ value: `Item ${i}`, selected: true, available: true }));
  control.update(model, large);
  const buttons = () => [...control.node.querySelectorAll('.slicer-item')];
  expect(buttons().length).toBeLessThan(20);
  buttons()[0].focus();
  const key = k => doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key('End'); expect(doc.activeElement.slicerItem.value).toBe('Item 19999');
  expect(doc.activeElement.getAttribute('aria-description')).toBe('Item 20000 of 20000');
  expect(buttons().length).toBeLessThan(20);
  key(' '); expect(changes.at(-1)).toEqual(['Item 19999']);
  key('ArrowUp'); expect(doc.activeElement.slicerItem.value).toBe('Item 19997');
  key('Home'); expect(doc.activeElement.slicerItem.value).toBe('Item 0');
});
it('retains an offscreen focused button without stealing scroll or expanding the track', () => {
  const { dom, doc, control } = make();
  const large = Array.from({ length: 5000 }, (_, i) => ({ value: `Item ${i}`, selected: true, available: true }));
  control.update(model, large);
  const original = control.node.querySelector('.slicer-item'); original.focus();
  const list = control.node.querySelector('.slicer-items'); list.scrollTop = 20000;
  list.dispatchEvent(new dom.window.Event('scroll'));
  expect(doc.activeElement).toBe(original);
  expect(parseFloat(original.style.top) + parseFloat(original.style.height)).toBeLessThanOrEqual(0);
  expect(control.node.querySelectorAll('.slicer-item').length).toBeLessThan(20);
  control.update(model, large.map(i => ({ ...i, selected: false })));
  expect(doc.activeElement).toBe(original); expect(list.scrollTop).toBe(20000);
  expect(original.getAttribute('aria-pressed')).toBe('false');
});
it('keeps range selection semantics across rows that are not mounted', () => {
  const changes = [], { dom, doc, control } = make(v => changes.push(v));
  const large = Array.from({ length: 100 }, (_, i) => ({ value: String(i), selected: false, available: true }));
  control.update(model, large); const first = control.node.querySelector('.slicer-item'); first.focus(); first.click();
  first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true, cancelable: true }));
  expect(changes).toEqual([['0'], null]);
});
it('compresses extreme native row-height tracks without changing the item height or last value', () => {
  const { dom, doc, control } = make();
  const large = Array.from({ length: 1000 }, (_, i) => ({ value: String(i), selected: true, available: true }));
  const huge = { ...model, columnCount: 1, rowHeight: 4294967295 };
  control.update(huge, large);
  const first = control.node.querySelector('.slicer-item'); first.focus();
  first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  expect(doc.activeElement.slicerItem.value).toBe('999');
  expect(parseFloat(doc.activeElement.style.height)).toBe(huge.rowHeight / 9525);
  expect(parseFloat(control.node.querySelector('.slicer-items').firstElementChild.style.height)).toBeLessThan(20000000);
  expect(control.node.querySelectorAll('.slicer-item').length).toBeLessThan(5);
});

it('retains logical keyboard alignment when a browser rounds compressed scroll offsets', () => {
  const { dom, doc, control } = make();
  const list = control.node.querySelector('.slicer-items'); let offset = 0;
  Object.defineProperty(list, 'scrollTop', { get: () => offset, set: value => { offset = Math.trunc(value); } });
  const large = Array.from({ length: 20000 }, (_, i) => ({ value: String(i), selected: true, available: true }));
  control.update({ ...model, columnCount: 1, rowHeight: 4294967295 }, large);
  const first = control.node.querySelector('.slicer-item'); first.focus();
  first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  expect(doc.activeElement.slicerItem.value).toBe('19999');
  expect(Math.abs(parseFloat(doc.activeElement.style.top) - list.scrollTop)).toBeLessThan(.01);
  list.dispatchEvent(new dom.window.Event('scroll'));
  expect(Math.abs(parseFloat(doc.activeElement.style.top) - list.scrollTop)).toBeLessThan(.01);
});
it('windows extreme column counts and reaches offscreen columns by keyboard', () => {
  const { dom, doc, control } = make();
  const large = Array.from({ length: 20000 }, (_, i) => ({ value: String(i), selected: true, available: true }));
  control.update({ ...model, columnCount: 20000 }, large);
  expect(control.node.querySelectorAll('.slicer-item').length).toBeLessThan(200);
  const first = control.node.querySelector('.slicer-item'); first.focus();
  first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  expect(doc.activeElement.slicerItem.value).toBe('19999');
  expect(control.node.querySelector('.slicer-items').scrollLeft).toBeGreaterThan(39000);
  expect(control.node.querySelectorAll('.slicer-item').length).toBeLessThan(200);
});

it.each(['ctrlKey', 'metaKey', 'multi', 'keyboard'])(
  'clears the criterion when %s toggles off the last selected item', mode => {
    const changes = [], { dom, control, item } = make(values => { changes.push(values); return false; });
    control.update(model, data.map(i => ({ ...i, selected: i.value === 'Beta', available: false })));
    if (mode === 'multi' || mode === 'keyboard') control.node.querySelector('[aria-label="Multi-select"]').click();
    if (mode === 'keyboard') item('Beta').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    else item('Beta').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, [mode]: true }));
    expect(changes).toEqual([null]);
    // A rejected edit does not optimistically change selection, even for no-data items.
    expect(item('Beta').getAttribute('aria-pressed')).toBe('true');
    expect(item('Alpha').getAttribute('aria-pressed')).toBe('false');
  });
it('keeps a one-item slicer selected when its only value is toggled off', () => {
  const changes = [], { dom, control, item } = make(values => changes.push(values));
  control.update(model, [{ value: '', selected: true, available: true }]);
  item('').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
  expect(changes).toEqual([null]);
});
it('clears only the slicer column when toggling its last selection and restores it on undo', () => {
  const wb = new Workbook(), s = wb.activeSheet;
  [['Category','Region'],['Alpha','East'],['Beta','West'],['Beta','East']].forEach((row,r) => row.forEach((v,c) => wb.setInput(s.id,r,c,v)));
  wb.addTable(s.id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'Orders' });
  const id = wb.addChart(s.id, { ...model, type: 'slicer', anchor: { r: 5, c: 0 }, tableRef: 'Orders[Category]' });
  wb.setFilterCriteria(s.id, 1, { values: ['East'] });
  setSlicerSelection(wb, s.id, id, ['Beta']);
  const { dom, control, item } = make(values => { const result = setSlicerSelection(wb, s.id, id, values); refresh(); return result; });
  const refresh = () => control.update(wb.chartById(s.id, id), slicerItems(wb, wb.chartById(s.id, id)));
  refresh(); expect([...s.filterHidden]).toEqual([1, 2]);
  item('Beta').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
  expect([...s.filterHidden]).toEqual([2]);
  expect(slicerItems(wb, wb.chartById(s.id, id)).every(i => i.selected)).toBe(true);
  wb.undo(); refresh(); expect([...s.filterHidden]).toEqual([1, 2]);
  expect(slicerItems(wb, wb.chartById(s.id, id)).filter(i => i.selected).map(i => i.value)).toEqual(['Beta']);
});

it('hides no-data buttons without clearing hidden selections during additive interaction', () => {
  const changes = [], { dom, control, item } = make(v => { changes.push(v); return false; });
  const state = data.map(i => ({ ...i, available: i.value !== 'Alpha' }));
  control.update({ ...model, hideItemsWithNoData: true }, state);
  expect(item('Alpha')).toBeUndefined();
  item('Beta').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
  expect(changes.pop()).toEqual(['Alpha', '', '<script>']);
  item('Beta').click(); expect(changes.pop()).toEqual(['Beta']);
  expect(item('Beta').getAttribute('aria-description')).toContain('Item 1 of 3');
});
it('does not treat selecting every visible item as clearing hidden unselected items', () => {
  const changes = [], { dom, control, item } = make(v => { changes.push(v); return false; });
  control.update({ ...model, hideItemsWithNoData: true }, [
    { value: 'Alpha', selected: false, available: false }, { value: 'Beta', selected: false, available: true },
  ]);
  item('Beta').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
  expect(changes.pop()).toEqual(['Beta']);
  const clear = control.node.querySelector('[aria-label="Clear filter"]'); expect(clear.disabled).toBe(false);
  clear.click(); expect(changes.pop()).toBeNull();
});
it('moves focus when an item becomes hidden and retains clear-filter access when all items are hidden', () => {
  const changes = [], { doc, control, item } = make(v => { changes.push(v); return false; });
  item('Alpha').focus();
  control.update({ ...model, hideItemsWithNoData: true }, data.map(i => ({ ...i, available: i.value !== 'Alpha' })));
  expect(doc.activeElement).toBe(item('Beta'));
  control.update({ ...model, hideItemsWithNoData: true }, data.map(i => ({ ...i, selected: i.value === 'Alpha', available: false })));
  expect(control.node.querySelectorAll('.slicer-item')).toHaveLength(0); expect(doc.activeElement).toBe(control.node);
  expect(control.node.querySelector('[aria-label="Clear filter"]').disabled).toBe(false);
  control.node.querySelector('[aria-label="Clear filter"]').click(); expect(changes.pop()).toBeNull();
});
it('uses explicit hidden state when no-data painting is suppressed', () => {
  const { control, item } = make();
  control.update({ ...model, hideItemsWithNoData: true }, data.map(i => ({ ...i, hidden: i.value === 'Alpha' })));
  expect(item('Alpha')).toBeUndefined(); expect(item('Beta')).toBeDefined();
  control.update(model, data); expect(item('Alpha')).toBeDefined();
});

it('keeps equal display labels as separate native member identities for mouse and keyboard selection', () => {
  const changes = [], { dom, doc, control } = make(v => { changes.push(v); return false; });
  control.update(model, [0,1,2].map(key => ({key,value:'1',selected:key===0,available:true})));
  const buttons = [...control.node.querySelectorAll('.slicer-item')];
  expect(buttons.length).toBe(3);
  expect(buttons.map(b=>b.textContent)).toEqual(['1','1','1']);
  buttons[1].click(); expect(changes.pop()).toEqual([1]);
  buttons[1].dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true})); expect(changes.pop()).toEqual([0,1]);
  buttons[0].focus();buttons[0].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  expect(doc.activeElement).toBe(buttons[1]);
  buttons[1].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true})); expect(changes.pop()).toEqual([1]);
});
it('retains keyed focus and DOM identity when labels change and native items reorder', () => {
  const { doc, control } = make();
  control.update(model,[{key:0,value:'First',selected:true,available:true},{key:1,value:'Second',selected:false,available:true}]);
  const button = [...control.node.querySelectorAll('.slicer-item')].find(b=>b.slicerItem.key===0); button.focus();
  control.update(model,[{key:1,value:'Renamed',selected:false,available:true},{key:0,value:'Renamed',selected:true,available:true}]);
  expect(doc.activeElement === button).toBe(true);expect(button.textContent).toBe('Renamed');
  expect(control.node.querySelectorAll('.slicer-item').length).toBe(2);
});
it('preserves hidden keyed choices in range selection and clears using the full identity set', () => {
  const changes=[], {dom,control}=make(v=>{changes.push(v);return true;});
  const state=[0,1,2,3].map(key=>({key,value:'Same',selected:key===0,available:key!==0}));
  control.update({...model,hideItemsWithNoData:true},state);
  const buttons=[...control.node.querySelectorAll('.slicer-item')]; expect(buttons.length).toBe(3);
  buttons[0].click();expect(changes.pop()).toEqual([1]);
  buttons[1].dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true,shiftKey:true}));
  expect(changes.pop()).toEqual([0,1,2]);
  buttons[2].dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true,shiftKey:true}));
  expect(changes.pop()).toEqual([0,2,3]);
  control.node.querySelector('[aria-label="Clear filter"]').click();expect(changes.pop()).toBeNull();
});

it('virtualizes equal-caption members and reaches the last native identity by keyboard', () => {
  const { dom, doc, control } = make();
  control.update({...model,columnCount:1},Array.from({length:20000},(_,key)=>({key,value:'Same caption',selected:true,available:true})));
  expect(control.node.querySelectorAll('.slicer-item').length).toBeLessThan(100);
  const first=control.node.querySelector('.slicer-item');first.focus();
  first.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
  expect(doc.activeElement.slicerItem.key).toBe(19999);
  expect(control.node.querySelectorAll('.slicer-item').length).toBeLessThan(100);
});

it('honors explicit unused-member visibility without requiring hide-no-data and preserves its selection', () => {
  const changes=[],{dom,control}=make(v=>{changes.push(v);return false;});
  control.update({...model,hideItemsWithNoData:false},[
    {key:0,value:'Retained',hidden:true,available:true,selected:true},
    {key:1,value:'Current',hidden:false,available:false,selected:false},
  ]);
  const buttons=[...control.node.querySelectorAll('.slicer-item')];
  expect(buttons.map(b=>b.textContent)).toEqual(['Current']);
  buttons[0].dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  expect(changes.pop()).toBeNull(); // Both identities are now selected, including the hidden one.
  buttons[0].click();expect(changes.pop()).toEqual([1]);
});
it('announces rejected refreshes without optimistic state changes or uncaught event errors', () => {
  const { control, item } = make(() => { throw new Error('The report overlaps existing cells.'); });
  item('Beta').click();
  expect(control.node.querySelector('[role="status"]').textContent).toBe('The report overlaps existing cells.');
  expect(control.node.querySelector('[role="status"]').hidden).toBe(false);
  expect(item('Beta').getAttribute('aria-pressed')).toBe('true');
  control.update(model, data);
  expect(control.node.querySelector('[role="status"]').hidden).toBe(true);
});
