"""Original controls for unwrapped page/margin anchors inside table cells."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
ROOT=Path(__file__).resolve().parents[1]
from canvas_anchor_position_fixture import make,W,WP
from lxml import etree as E
from copy import deepcopy
from zipfile import ZipFile,ZIP_DEFLATED
q=lambda n:'{'+W+'}'+n
mode=12 if '--legacy' in sys.argv else 15
parts=make(mode);root=E.fromstring(parts['word/document.xml'].encode());body=root.find(q('body'));pbase=deepcopy(body.find(q('p')));sect=deepcopy(body.find(q('sectPr')));body.clear()
cases=[]
for behind in [True,False]:
 for incell in [True,False]:
  for base,pos in [('page',0),('page',1270000),('margin',0),('page','center')]:cases.append((behind,incell,base,pos))
cases += [(False,True,'page',-254000),(False,True,'margin','right'),(False,True,'page',0),(False,True,'margin','center'),(False,True,'page',1270000),(False,True,'page',0)]
for i,(behind,incell,base,pos) in enumerate(cases):
 p=E.SubElement(body,q('p'));pr=E.SubElement(p,q('pPr'))
 if i:E.SubElement(pr,q('pageBreakBefore'))
 E.SubElement(pr,q('spacing'),{q('after'):'0',q('line'):'400',q('lineRule'):'exact'})
 E.SubElement(E.SubElement(p,q('r')),q('t')).text=f'Cell anchor {i+1}: behind={behind} inCell={incell} {base} {pos}'
 tbl=E.SubElement(body,q('tbl'));pr=E.SubElement(tbl,q('tblPr'));E.SubElement(pr,q('tblW'),{q('w'):'5760',q('type'):'dxa'});E.SubElement(pr,q('tblLayout'),{q('type'):'fixed'});m=E.SubElement(pr,q('tblCellMar'))
 for edge in ['top','left','bottom','right']:E.SubElement(m,q(edge),{q('w'):str(240 if i in [18,19,21] else 0),q('type'):'dxa'})
 grid=E.SubElement(tbl,q('tblGrid'))
 for j in range(2):E.SubElement(grid,q('gridCol'),{q('w'):'2880'})
 row=E.SubElement(tbl,q('tr'));pr=E.SubElement(row,q('trPr'));E.SubElement(pr,q('trHeight'),{q('val'):'1440',q('hRule'):'exact' if i==20 else 'atLeast'})
 for j in range(2):
  cell=E.SubElement(row,q('tc'));pr=E.SubElement(cell,q('tcPr'));E.SubElement(pr,q('tcW'),{q('w'):'2880',q('type'):'dxa'});E.SubElement(pr,q('shd'),{q('val'):'clear',q('fill'):'DDDDDD' if j==0 else 'EEEEEE'})
  if j==0:E.SubElement(E.SubElement(E.SubElement(cell,q('p')),q('r')),q('t')).text='First cell'
  else:
   p=deepcopy(pbase);p.find('.//'+q('t')).text='Anchor cell';a=p.find('.//{'+WP+'}anchor');a.set('behindDoc',str(int(behind)));a.set('layoutInCell',str(int(incell)));a.find('{'+WP+'}docPr').set('id',str(i+1))
   for axis in ['H','V']:
    n=a.find('{'+WP+'}position'+axis);n.clear();n.set('relativeFrom',base);E.SubElement(n,'{'+WP+'}'+('posOffset' if isinstance(pos,int) else 'align')).text=str(('bottom' if pos=='right' else pos) if axis=='V' else pos)
   if i==21:E.SubElement(E.SubElement(E.SubElement(cell,q('p')),q('r')),q('t')).text='Before anchor'
   cell.append(p)
 E.SubElement(E.SubElement(E.SubElement(body,q('p')),q('r')),q('t')).text='After table'
body.append(sect);parts['word/document.xml']=E.tostring(root)
out=ROOT/'public/fixtures'/('table-global-anchors'+('-legacy' if mode==12 else '')+'.docx')
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
print(out)
