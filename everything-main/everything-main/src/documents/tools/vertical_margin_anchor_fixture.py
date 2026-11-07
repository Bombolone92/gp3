"""Independent top/bottom-margin anchors in body paragraphs and table cells."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json

root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/vertical-margin-anchors';out.mkdir(exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
q=lambda n:'{'+w+'}'+n
for suffix in ['', '-legacy']:
 with ZipFile(root/f'public/fixtures/table-global-anchors{suffix}.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 r=E.fromstring(parts['word/document.xml']);body=r.find(q('body'));tableBase=body.find(q('tbl'));titleBase=tableBase.getprevious();section=deepcopy(body.find(q('sectPr')))
 nodes=[];cases=[]
 for base in ['topMargin','bottomMargin']:
  for context in ['body','cell','outside-cell']:
   for mode in ['offset','center','bottom']:
    page=len(cases);title=deepcopy(titleBase);table=deepcopy(tableBase)
    for marker in title.findall('.//'+q('pageBreakBefore')):marker.getparent().remove(marker)
    if page:title.find(q('pPr')).insert(0,E.Element(q('pageBreakBefore')))
    title.find('.//'+q('t')).text=f'{base} {context} {mode}'
    anchor=table.find('.//{'+wp+'}anchor');anchor.set('layoutInCell','0' if context=='outside-cell' else '1');anchor.set('behindDoc','0');anchor.find('{'+wp+'}docPr').set('id',str(page+1))
    pos=anchor.find('{'+wp+'}positionH');pos.clear();pos.set('relativeFrom','page');E.SubElement(pos,'{'+wp+'}posOffset').text='1270000'
    pos=anchor.find('{'+wp+'}positionV');pos.clear();pos.set('relativeFrom',base)
    E.SubElement(pos,'{'+wp+'}posOffset' if mode=='offset' else '{'+wp+'}align').text='152400' if mode=='offset' else mode
    nodes.append(title)
    if context=='body':
     paragraph=next(n for n in anchor.iterancestors() if E.QName(n).localname=='p');nodes.append(deepcopy(paragraph))
    else:nodes.append(table)
    after=E.Element(q('p'));E.SubElement(E.SubElement(after,q('r')),q('t')).text='After anchor';nodes.append(after)
    cases.append(dict(page=page,base=base,context=context,mode=mode))
 body.clear();body.extend(nodes);body.append(section)
 for run in r.findall('.//'+q('r')):
  pr=run.find(q('rPr'))
  if pr is None:pr=E.Element(q('rPr'));run.insert(0,pr)
  fonts=pr.find(q('rFonts'))
  if fonts is None:fonts=E.SubElement(pr,q('rFonts'))
  for name in ['ascii','hAnsi','eastAsia','cs']:fonts.set(q(name),'Arial')
 parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='utf-8',standalone=True)
 with ZipFile(out/f'control{suffix}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
 (out/f'cases{suffix}.json').write_text(json.dumps(cases,indent=2)+'\n')
