from pathlib import Path
import re,os
source=Path('src/facilitation/ui.js').read_text()
helper='''function shortLabel(text) {
  let end = Math.min(text.length, 120);
  const last = text.charCodeAt(end - 1), next = text.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return text.slice(0, end);
}
'''
assert 'function shortLabel(' not in source
source=source.replace('const fill = (text, values) =>',helper+'const fill = (text, values) =>',1)
assert source.count('return (text ? text : objectName(i)).slice(0, 120);')==1
source=source.replace('return (text ? text : objectName(i)).slice(0, 120);','return shortLabel(text ? text : objectName(i));')
assert source.count('authoredTextHTML(i, text.slice(0, 120), i.text.indexOf(text))')==1
source=source.replace('authoredTextHTML(i, text.slice(0, 120), i.text.indexOf(text))','authoredTextHTML(i, shortLabel(text), i.text.indexOf(text))')
Path('tmp/facilitation-unicode-current-candidate-source.js').write_text(source)
def normalize(m):
 rel=os.path.relpath((Path('src/facilitation')/m.group(2)).resolve(),Path('tmp').resolve())
 return m.group(1)+rel+m.group(3)
normalized=re.sub(r'(from [\"\'])(\.[^\"\']+)([\"\'])',normalize,source)
Path('tmp/facilitation-unicode-current-candidate.js').write_text(normalized)
tests=Path('tests/facilitation.test.js').read_text()
constants=tests[tests.index('const vote ='):tests.index('\ntest("workshop registers')]
stub=tests[tests.index('function stubUI('):tests.index('\ntest("the contribution summary',tests.index('function stubUI('))]
head='''import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { board as newBoard, item, validateBoard } from '../src/model.js';
import { voteKey } from '../src/facilitation/model.js';
import { owner } from '../tests/collaboration-helpers.js';
import { language, setLanguage, t, objectKind } from '../src/i18n.js';
import { createCanvas } from '../tests/canvas.js';
const { createFacilitationUI } = await import(process.env.VOTE_UNIT_MODULE || '../src/facilitation/ui.js');
'''
fragments='\n'.join(Path(f).read_text() for f in ['tmp/facilitation-unicode-regressions.js','tmp/vote-unicode-language-unit-regressions.js','tmp/table-object-name-unicode-facilitation-regressions.js','tmp/vote-unicode-fallback-component-regressions.js'])
Path('tmp/vote-unicode-current-component-regressions.test.js').write_text(head+constants+'\n'+stub+'\n'+fragments)
print('Prepared ignored current-source candidate and20component-only cases without Vite/appBundle')
