"""Original controls for vertical alignment of mixed-axis cell anchors."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag,add,shape,NS
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/mixed-cell-alignment';OUT.mkdir(exist_ok=True)
with ZipFile(ROOT/'tests/fixtures/mixed-cell-anchors/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
styles=E.fromstring(parts['word/styles.xml'])
rp=styles.find('w:docDefaults/w:rPrDefault/w:rPr',NS)
fonts=E.Element(tag('w:rFonts'),{tag('w:'+key):'Arial' for key in ['ascii','hAnsi','eastAsia','cs']});rp.insert(0,fonts)
parts['word/styles.xml']=E.tostring(styles,encoding='UTF-8',xml_declaration=True,standalone=True)
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'));table=body.findall(tag('w:tbl'))[2];title=table.getprevious();after=table.getnext();sect=deepcopy(body.find(tag('w:sectPr')));nodes=[];cases=[]
for horizontal in ['page','column']:
 for kind in ['picture','line']:
  for alignment in ['top','center','bottom']:
   i=len(cases);tbl=deepcopy(table);heading=deepcopy(title)
   for br in heading.findall('.//'+tag('w:pageBreakBefore')):br.getparent().remove(br)
   if i:heading.find(tag('w:pPr')).insert(0,E.Element(tag('w:pageBreakBefore')))
   heading.find('.//'+tag('w:t')).text=f'Anchor alignment {horizontal} {kind} {alignment}'
   a=tbl.find('.//'+tag('wp:anchor'));a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:positionH')).set('relativeFrom',horizontal)
   cell=next(p for p in a.iterancestors() if p.tag==tag('w:tc'));props=cell.find(tag('w:tcPr'))
   margins=add(props,'w:tcMar');add(margins,'w:left',**{'w:w':240,'w:type':'dxa'})
   va=props.find(tag('w:vAlign'))
   if va is None:va=add(props,'w:vAlign',**{'w:val':alignment})
   else:va.set(tag('w:val'),alignment)
   tr=tbl.find(tag('w:tr'));height=tr.find('w:trPr/w:trHeight',NS);height.set(tag('w:val'),'1600');height.set(tag('w:hRule'),'exact')
   if kind=='line':
    a.find(tag('wp:extent')).set('cy','0')
    data=a.find('.//'+tag('a:graphicData'));data.clear();data.set('uri',NS['wps'])
    s=shape(data,100+i,72*12700,0,0,0,'1565C0');sp=s.find(tag('wps:spPr'));sp.find(tag('a:prstGeom')).set('prst','line');pen=sp.find(tag('a:ln'));pen.clear();pen.set('w',str(5*12700));pen.set('cap','rnd');add(add(pen,'a:solidFill'),'a:srgbClr',val='1565C0')
   nodes.extend([heading,tbl,deepcopy(after)]);cases.append(dict(page=i,horizontal=horizontal,kind=kind,alignment=alignment))
body.clear();body.extend(nodes);body.append(sect);parts['word/document.xml']=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
