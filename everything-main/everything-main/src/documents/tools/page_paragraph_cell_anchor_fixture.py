"""Original page/margin-horizontal and paragraph-vertical cell anchor controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/page-paragraph-cell-anchors';out.mkdir(exist_ok=True)
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';wp='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';q=lambda n:'{'+w+'}'+n
for suffix in ['', '-legacy']:
 with ZipFile(root/f'public/fixtures/table-global-anchors{suffix}.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 r=E.fromstring(parts['word/document.xml']);body=r.find(q('body'));tables=body.findall(q('tbl'));section=deepcopy(body.find(q('sectPr')));nodes=[];cases=[]
 for base in ['page','margin']:
  for inCell,index in [('1',0),('0',4)]:
   for vertical in ['top','center','bottom']:
    table=deepcopy(tables[index]);title=deepcopy(tables[index].getprevious());page=len(cases)
    for marker in title.findall('.//'+q('pageBreakBefore')):marker.getparent().remove(marker)
    if page:title.find(q('pPr')).insert(0,E.Element(q('pageBreakBefore')))
    title.find('.//'+q('t')).text=f'{base}/paragraph inCell={inCell} align={vertical}'
    anchor=table.find('.//{'+wp+'}anchor');anchor.set('behindDoc','0');anchor.set('layoutInCell',inCell);anchor.find('{'+wp+'}docPr').set('id',str(page+1))
    for axis,relative,offset in [('H',base,127000),('V','paragraph',152400)]:
     pos=anchor.find('{'+wp+'}position'+axis);pos.clear();pos.set('relativeFrom',relative);E.SubElement(pos,'{'+wp+'}posOffset').text=str(offset)
    table.find('.//'+q('trHeight')).set(q('val'),'2880')
    cell=next(n for n in anchor.iterancestors() if E.QName(n).localname=='tc');props=cell.find(q('tcPr'))
    margins=props.find(q('tcMar'))
    if margins is None:margins=E.SubElement(props,q('tcMar'))
    for side,value in [('top',240),('left',180)]:
     node=margins.find(q(side))
     if node is None:node=E.SubElement(margins,q(side))
     node.set(q('w'),str(value));node.set(q('type'),'dxa')
    va=props.find(q('vAlign'))
    if va is None:va=E.SubElement(props,q('vAlign'))
    va.set(q('val'),vertical)
    paragraph=cell.find(q('p'));before=deepcopy(paragraph)
    for run in before.findall(q('r')):before.remove(run)
    E.SubElement(E.SubElement(before,q('r')),q('t')).text='Before anchor'
    cell.insert(list(cell).index(paragraph),before)
    # Fixed paragraph advances isolate coordinates from native font fallback.
    for p in [before,paragraph]:
     pr=p.find(q('pPr'))
     if pr is None:pr=E.Element(q('pPr'));p.insert(0,pr)
     spacing=pr.find(q('spacing'))
     if spacing is None:spacing=E.SubElement(pr,q('spacing'))
     for key,value in [('before','0'),('after','0'),('line','480'),('lineRule','exact')]:spacing.set(q(key),value)
    # A leading row distinguishes the table origin from the anchor cell origin.
    row=table.find(q('tr'));leading=deepcopy(row);leading.find('.//'+q('trHeight')).set(q('val'),'720')
    for leadCell in leading.findall(q('tc')):
     leadProps=leadCell.find(q('tcPr'))
     for name in ['tcMar','vAlign']:
      item=leadProps.find(q(name))
      if item is not None:leadProps.remove(item)
     for item in list(leadCell):
      if item is not leadProps:leadCell.remove(item)
     E.SubElement(E.SubElement(E.SubElement(leadCell,q('p')),q('r')),q('t')).text='Leading row'
    table.insert(list(table).index(row),leading)
    nodes.extend([title,table,deepcopy(tables[index].getnext())]);cases.append(dict(page=page,horizontal=base,inCell=inCell,verticalAlignment=vertical))
 body.clear();body.extend(nodes);body.append(section)
 for run in r.findall('.//'+q('r')):
  pr=run.find(q('rPr'))
  if pr is None:pr=E.Element(q('rPr'));run.insert(0,pr)
  fonts=E.SubElement(pr,q('rFonts'))
  for name in ['ascii','hAnsi','eastAsia','cs']:fonts.set(q(name),'Arial')
 parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='utf-8',standalone=True)
 with ZipFile(out/f'control{suffix}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
 (out/f'cases{suffix}.json').write_text(json.dumps(cases,indent=2)+'\n')
