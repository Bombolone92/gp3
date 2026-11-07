"""Original wrapNone cell-flow controls, authored as OOXML and an original PNG."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
from canvas_anchor_position_fixture import make,W,WP
from lxml import etree as E
from copy import deepcopy
from zipfile import ZipFile,ZIP_DEFLATED
q=lambda n:'{'+W+'}'+n
parts=make(15);root=E.fromstring(parts['word/document.xml'].encode());body=root.find(q('body'));anchor=deepcopy(root.find('.//{'+WP+'}anchor'));body.clear()
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
def paragraph(parent,label,page=False):
 p=E.SubElement(parent,q('p'));pr=E.SubElement(p,q('pPr'))
 if page:E.SubElement(pr,q('pageBreakBefore'))
 E.SubElement(pr,q('spacing'),{q('before'):'0',q('after'):'0',q('line'):'240',q('lineRule'):'exact'})
 E.SubElement(E.SubElement(p,q('r')),q('t')).text=label
 return p
cases=[('AutoTwo',2,None),('AutoFive',5,None),('Minimum',2,'atLeast'),('Exact',2,'exact'),('Alone',1,None)]
for i,(label,count,rule) in enumerate(cases):
 paragraph(body,label,i>0)
 t=E.SubElement(body,q('tbl'));pr=E.SubElement(t,q('tblPr'));E.SubElement(pr,q('tblW'),{q('w'):'4320',q('type'):'dxa'});E.SubElement(pr,q('tblLayout'),{q('type'):'fixed'});m=E.SubElement(pr,q('tblCellMar'))
 for s in ['top','left','bottom','right']:E.SubElement(m,q(s),{q('w'):'0',q('type'):'dxa'})
 E.SubElement(E.SubElement(t,q('tblGrid')),q('gridCol'),{q('w'):'4320'})
 row=E.SubElement(t,q('tr'))
 if rule:E.SubElement(E.SubElement(row,q('trPr')),q('trHeight'),{q('val'):str((24 if rule=='exact' else 72)*20),q('hRule'):rule})
 cell=E.SubElement(row,q('tc'));pr=E.SubElement(cell,q('tcPr'));E.SubElement(pr,q('shd'),{q('val'):'clear',q('fill'):'DDDDDD'})
 for j in range(count):
  p=paragraph(cell,label+str(j))
  if j==0:
   a=deepcopy(anchor);a.set('behindDoc','0');a.find('{'+WP+'}docPr').set('id',str(i+1))
   for axis,base,offset in [('H','column',108),('V','paragraph',12)]:
    n=a.find('{'+WP+'}position'+axis);n.clear();n.set('relativeFrom',base);E.SubElement(n,'{'+WP+'}posOffset').text=str(offset*12700)
   E.SubElement(E.SubElement(p,q('r')),q('drawing')).append(a)
 paragraph(body,label+'End')
s=E.SubElement(body,q('sectPr'));E.SubElement(s,q('pgSz'),{q('w'):'12240',q('h'):'15840'});E.SubElement(s,q('pgMar'),{q(k):str(720 if k in ['top','left','bottom','right'] else 0) for k in ['top','left','bottom','right','header','footer','gutter']})
parts['word/document.xml']=E.tostring(root)
def write(name, parts):
 with ZipFile(ROOT/'public/fixtures'/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
write('cell-anchor-flow',parts)
legacy=dict(parts);legacy['word/settings.xml']=parts['word/settings.xml'].replace('w:val="15"','w:val="12"')
write('cell-anchor-flow-legacy',legacy)

root=E.fromstring(parts['word/document.xml']);body=root.find(q('body'));header,table,tail=map(deepcopy,list(body)[:3]);sect=deepcopy(body[-1]);body.clear()
for i,name in enumerate(['Negative','Horizontal','Behind','LayoutOut','Bottom','Center','Second']):
 h=deepcopy(header);h.find('.//'+q('t')).text=name
 if i:h.find(q('pPr')).insert(0,E.Element(q('pageBreakBefore')))
 body.append(h);t=deepcopy(table);body.append(t);cell=t.find('.//'+q('tc'));ps=cell.findall(q('p'))
 for j,p in enumerate(ps):p.find('.//'+q('t')).text=name+str(j)
 a=t.find('.//{'+WP+'}anchor');a.find('{'+WP+'}docPr').set('id',str(i+1))
 if name=='Negative':a.find('{'+WP+'}positionV/{'+WP+'}posOffset').text=str(-18*12700)
 if name=='Horizontal':a.find('{'+WP+'}positionH/{'+WP+'}posOffset').text=str(200*12700)
 if name=='Behind':a.set('behindDoc','1')
 if name=='LayoutOut':a.set('layoutInCell','0')
 if name in ['Bottom','Center']:
  tr=t.find(q('tr'));pr=E.Element(q('trPr'));E.SubElement(pr,q('trHeight'),{q('val'):'1440',q('hRule'):'atLeast'});tr.insert(0,pr)
  E.SubElement(cell.find(q('tcPr')),q('vAlign'),{q('val'):name.lower()})
 if name=='Second':
  run=a.getparent().getparent();run.getparent().remove(run);ps[1].append(run)
 end=deepcopy(tail);end.find('.//'+q('t')).text=name+'End';body.append(end)
body.append(sect);parts['word/document.xml']=E.tostring(root)
write('cell-anchor-flow-edges',parts)
legacy=dict(parts);legacy['word/settings.xml']=parts['word/settings.xml'].replace('w:val="15"','w:val="12"')
write('cell-anchor-flow-edges-legacy',legacy)

with ZipFile(ROOT/'public/fixtures/cell-anchor-flow.docx') as z:originBase={n:z.read(n) for n in z.namelist()}
root=E.fromstring(originBase['word/document.xml']);body=root.find(q('body'));header,table,tail=map(deepcopy,list(body)[:3]);sect=deepcopy(body[-1]);body.clear()
for i,incell in enumerate([1,0]):
 h=deepcopy(header);h.find('.//'+q('t')).text='Origin'+str(incell)
 if i:h.find(q('pPr')).insert(0,E.Element(q('pageBreakBefore')))
 body.append(h);t=deepcopy(table);body.append(t)
 pr=t.find(q('tblPr'));pr.find(q('tblW')).set(q('w'),'8640');pr.insert(1,E.Element(q('tblInd'),{q('w'):'720',q('type'):'dxa'}))
 grid=t.find(q('tblGrid'));grid.append(deepcopy(grid[0]));row=t.find(q('tr'));cell=row.find(q('tc'));left=deepcopy(cell)
 for p in left.findall(q('p')):left.remove(p)
 E.SubElement(E.SubElement(E.SubElement(left,q('p')),q('r')),q('t')).text='Left';row.insert(0,left)
 for j,p in enumerate(cell.findall(q('p'))):p.find('.//'+q('t')).text='Origin'+str(incell)+str(j)
 a=t.find('.//{'+WP+'}anchor');a.set('layoutInCell',str(incell));a.find('{'+WP+'}docPr').set('id',str(i+1))
 end=deepcopy(tail);end.find('.//'+q('t')).text='OriginEnd'+str(incell);body.append(end)
body.append(sect)
for mode in [12,15]:
 parts=dict(originBase);parts['word/document.xml']=E.tostring(root);parts['word/settings.xml']=parts['word/settings.xml'].replace(b'w:val="15"',f'w:val="{mode}"'.encode())
 write('cell-anchor-origin-'+str(mode),parts)
