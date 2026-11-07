"""Independent mixed column/page cell anchors from original table controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/mixed-cell-anchors'
OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
q=lambda n:'{'+W+'}'+n
for suffix in ['', '-legacy']:
    with ZipFile(ROOT/f'public/fixtures/table-global-anchors{suffix}.docx') as z:
        parts={n:z.read(n) for n in z.namelist()}
    root=E.fromstring(parts['word/document.xml']);body=root.find(q('body'))
    tables=body.findall(q('tbl'));sect=deepcopy(body.find(q('sectPr')))
    rows=[];nodes=[]
    for i,index in enumerate([0,4,8,12]):
        table=deepcopy(tables[index]);title=deepcopy(tables[index].getprevious())
        for marker in title.findall('.//'+q('pageBreakBefore')):marker.getparent().remove(marker)
        if i:title.find(q('pPr')).insert(0,E.Element(q('pageBreakBefore')))
        a=table.find('.//{'+WP+'}anchor')
        title.find('.//'+q('t')).text=f'Mixed column/page: behind={a.get("behindDoc")} inCell={a.get("layoutInCell")}'
        for axis,base,offset in [('H','column',127000),('V','page',152400)]:
            pos=a.find('{'+WP+'}position'+axis);pos.clear();pos.set('relativeFrom',base)
            E.SubElement(pos,'{'+WP+'}posOffset').text=str(offset)
        a.find('{'+WP+'}docPr').set('id',str(i+1))
        nodes.extend([title,table,deepcopy(tables[index].getnext())])
        rows.append(dict(page=i,behind=a.get('behindDoc'),inCell=a.get('layoutInCell'),horizontal='column',vertical='page',xOffsetPt=10,yOffsetPt=12))
    body.clear();body.extend(nodes);body.append(sect)
    parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(OUT/f'control{suffix}.docx','w',ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)
    (OUT/f'cases{suffix}.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
