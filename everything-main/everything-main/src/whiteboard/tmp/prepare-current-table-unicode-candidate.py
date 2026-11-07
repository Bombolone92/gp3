from pathlib import Path
import re,os
paths={'src/i18n.js':'tmp/i18n-table-current-candidate.js','src/accessibility/object-content.js':'tmp/object-content-table-current-candidate.js','src/facilitation/ui.js':'tmp/facilitation-table-current-candidate.js'}
i18n=Path('src/i18n.js').read_text();old=i18n[i18n.index('export const objectName ='):]
helper='''export function objectNameContent(i) {
  const value = i.text || i.alt || i.fileName;
  if (value || !i.cells) return value || "";
  const text = i.cells.flat().filter(Boolean).join(" · ");
  let end = Math.min(300, text.length);
  const previous = text.charCodeAt(end - 1), next = text.charCodeAt(end);
  if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return text.slice(0, end);
}
'''
assert old.count('i.text || i.alt || i.fileName || (i.cells ? i.cells.flat().filter(Boolean).join(" · ").slice(0, 300) : "")')==1
i18n=i18n.replace(old,helper+old.replace('i.text || i.alt || i.fileName || (i.cells ? i.cells.flat().filter(Boolean).join(" · ").slice(0, 300) : "")','objectNameContent(i)'),1)
content=Path('src/accessibility/object-content.js').read_text().replace('import { objectName }','import { objectName, objectNameContent }',1)
body='''i.text ||
    i.alt ||
    i.fileName ||
    (i.cells ? i.cells.flat().filter(Boolean).join(" · ").slice(0, 300) : "")'''
assert content.count(body)==1;content=content.replace(body,'objectNameContent(i)',1)
fac=Path('src/facilitation/ui.js').read_text().replace('import { labelled, t, language, objectName }','import { labelled, t, language, objectName, objectNameContent }',1)
body='''i.text ||
          i.alt ||
          i.fileName ||
          (i.cells
            ? i.cells.flat().filter(Boolean).join(" · ").slice(0, 300)
            : "")'''
assert fac.count(body)==1;fac=fac.replace(body,'objectNameContent(i)',1)
for path,source in [('src/i18n.js',i18n),('src/accessibility/object-content.js',content),('src/facilitation/ui.js',fac)]:
 raw=paths[path].replace('.js','-source.js');Path(raw).write_text(source)
 def normalize(m):
  target=str((Path(path).parent/m.group(2)).resolve().relative_to(Path.cwd()))
  dest=paths.get(target,target)
  rel=os.path.relpath(Path(dest).resolve(),Path('tmp').resolve())
  if not rel.startswith('.'):rel='./'+rel
  return m.group(1)+rel+m.group(3)
 Path(paths[path]).write_text(re.sub(r'(from [\"\'])(\.[^\"\']+)([\"\'])',normalize,source))
raw=Path('tmp/table-object-name-unicode-expanded-unit-regressions.js').read_text().replace("previous=globalThis.document;", "previous=globalThis.document,previousLanguage=language;").replace("setLanguage('en');", "setLanguage(previousLanguage);")
Path('tmp/table-object-name-unicode-expanded-unit-regressions.js').write_text(raw)
head='''import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM}from 'jsdom';import {language,objectName,objectKind,t,setLanguage}from './i18n-table-current-candidate.js';import {objectNameHTML}from './object-content-table-current-candidate.js';\n'''
Path('tmp/table-unicode-current-combined-unit.test.js').write_text(head+raw)
facTest=Path('tmp/vote-unicode-current-component-regressions.test.js').read_text().replace("'../src/i18n.js'","'./i18n-table-current-candidate.js'").replace("const { createFacilitationUI } = await import(process.env.VOTE_UNIT_MODULE || '../src/facilitation/ui.js');","const { createFacilitationUI } = await import('./facilitation-table-current-candidate.js');")
Path('tmp/table-vote-unicode-current-combined-component.test.js').write_text(facTest)
print('Prepared ignored3module composition preserving latest finitecaption guard and120vote candidate')
