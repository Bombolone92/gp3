// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openValidationManager } from '../src/ui/validation.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});

it('preserves imported alert settings on a no-op save and lets users choose an alert', () => {
  const wb=new Workbook(),id=wb.activeSheetId,range={r1:0,c1:0,r2:2,c2:0};
  wb.addValidation(id,{range,type:'list',source:'Yes, No',strict:false,errorStyle:'warning',showErrorMessage:true,errorTitle:'Pick one'});
  const {panel}=openValidationManager({wb,sheetId:()=>id,range:()=>range});
  const load=()=>panel.querySelector('.names-main').click(),save=()=>panel.querySelector('form').requestSubmit();
  load();const before=wb.toJSON();save();expect(wb.toJSON()).toEqual(before);
  load();const alert=panel.querySelector('[aria-label="Invalid entry alert"]');alert.value='information';save();
  expect(wb.activeSheet.validations[0]).toMatchObject({strict:false,errorStyle:'information',showErrorMessage:true,errorTitle:'Pick one'});
  load();alert.value='none';save();expect(wb.activeSheet.validations[0]).toMatchObject({strict:false,showErrorMessage:false});
});

it.each(['add', 'edit', 'delete'])('retains a validation draft when protection blocks %s, then allows retry and undo', (action) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
  if (action !== 'add') wb.addValidation(id, { range, type: 'list', source: 'Yes, No' });
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => range });
  if (action !== 'add') panel.querySelector('.names-main').click();
  const source = panel.querySelector('[aria-label="List options"]');
  const prompt = panel.querySelector('[aria-label="Input message"]');
  source.value = 'Ready, Waiting, Done';
  prompt.value = 'Choose the current status';
  const save = panel.querySelector('[type="submit"]');
  const label = save.textContent;
  const act = () => action === 'delete'
    ? panel.querySelector('[aria-label="Delete rule for A1:A3"]').click()
    : panel.querySelector('form').requestSubmit();
  wb.setSheetProtected(id, true);
  const before = JSON.stringify(wb.sheet(id).validations);
  const version = wb.version;
  act();
  expect(JSON.stringify(wb.sheet(id).validations)).toBe(before);
  expect(wb.version).toBe(version);
  expect(source.value).toBe('Ready, Waiting, Done');
  expect(prompt.value).toBe('Choose the current status');
  expect(save.textContent).toBe(label);
  const error = panel.querySelector('.field-error');
  expect(error.hidden).toBe(false);
  expect(error.textContent).toMatch(/protected/i);
  expect(toast).not.toHaveBeenCalled();
  wb.setSheetProtected(id, false);
  act();
  expect(error.hidden).toBe(true);
  if (action === 'delete') expect(wb.sheet(id).validations).toHaveLength(0);
  else {
    expect(wb.sheet(id).validations).toHaveLength(1);
    expect(wb.sheet(id).validations[0]).toMatchObject({ source: 'Ready, Waiting, Done', prompt: 'Choose the current status' });
    expect(toast).toHaveBeenCalledWith(action === 'add' ? 'Rule added' : 'Rule updated');
  }
  wb.undo();
  expect(JSON.stringify(wb.sheet(id).validations)).toBe(before);
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('creates and edits chip colors for options that also name object properties', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 2, c2: 0 };
  const errors = [];
  const onError = (event) => { errors.push(event.error); event.preventDefault(); };
  window.addEventListener('error', onError);
  try {
    const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => range });
    panel.querySelector('[aria-label="List options"]').value = '__proto__, constructor, toString, Ready';
    panel.querySelector('.chips-field input').click();
    expect(errors).toEqual([]);
    expect(panel.querySelectorAll('.chip-color-row')).toHaveLength(4);
    const select = panel.querySelector('[aria-label="Color for __proto__"]');
    select.value = '#fde3e0';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    panel.querySelector('form').requestSubmit();
    expect(wb.sheet(id).validations[0].colors).toEqual({ ['__proto__']: '#fde3e0' });
    panel.querySelector('.names-main').click();
    expect(errors).toEqual([]);
    expect(panel.querySelector('[aria-label="Color for __proto__"]').value).toBe('#fde3e0');
    expect(panel.querySelector('[aria-label="Color for constructor"]').value).toBe('');
    const before = wb.toJSON();
    panel.querySelector('form').requestSubmit();
    expect(wb.toJSON()).toEqual(before);
  } finally {
    window.removeEventListener('error', onError);
  }
});

it.each([
  ['Acme, Inc.', 'Line\r\nBreak', ' East ', 'Say "hello"', 1234567890123, false],
  ['A1:A3'],
  ['=Options'],
].map((source) => [source]))('keeps literal generated options intact when editing a rule', (source) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
  wb.addValidation(id, { type: 'list', range, source, strict: false });
  const { panel } = openValidationManager({ wb, sheetId: () => id, range: () => range });
  panel.querySelector('.names-main').click();
  panel.querySelector('[aria-label="Input message"]').value = 'Pick one';
  panel.querySelector('form').requestSubmit();
  expect(wb.sheet(id).validations[0].source).toEqual(source);
  expect(wb.sheet(id).validations[0].prompt).toBe('Pick one');
  panel.querySelector('.names-main').click();
  panel.querySelector('[aria-label="List options"]').value += ',New label';
  panel.querySelector('form').requestSubmit();
  expect(wb.sheet(id).validations[0].source).toEqual([...source, 'New label']);
});

it('previews and saves a named list source while editing a literal list', () => {
  const wb=new Workbook(), id=wb.activeSheetId, range={r1:0,c1:3,r2:2,c2:3};
  wb.setInput(id,0,0,'Red'); wb.setInput(id,1,0,'Green'); wb.defineName('Options','Sheet1!A1:A2');
  wb.addValidation(id,{range,type:'list',source:['Old option'],chips:true});
  const {panel}=openValidationManager({wb,sheetId:()=>id,range:()=>range});
  panel.querySelector('.names-main').click();
  const input=panel.querySelector('[aria-label="List options"]'); input.value='=Options';
  input.dispatchEvent(new Event('input',{bubbles:true}));
  expect([...panel.querySelectorAll('.chip-color-row .chip')].map(el=>el.textContent)).toEqual(['Red','Green']);
  panel.querySelector('form').requestSubmit();
  expect(wb.sheet(id).validations[0].source).toBe('=Options');
  expect(wb.validateInput(id,0,3,'Green').ok).toBe(true);
  wb.undo(); expect(wb.sheet(id).validations[0].source).toEqual(['Old option']);
});
