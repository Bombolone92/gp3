"""Independent row-justification OPC/XML probe; standard library only."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from canvas_first_section_fixture import parts as base,W,R
cases=[('left',['center','right','left']),('right',['left','center','right']),('center',[None,None,None]),('center',['left',None,'right']),('center',[None,'start',None]),('center',[None,None,None])]
body=''
for i,(align,rows) in enumerate(cases):
 body+=f'<w:p><w:r><w:t>Row alignment {i}</w:t></w:r></w:p>'
 body+=f'<w:tbl><w:tblPr><w:tblW w:w="2880" w:type="dxa"/><w:jc w:val="{align}"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblBorders>'+''.join(f'<w:{side} w:val="single" w:sz="4" w:color="000000"/>' for side in ['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid>'
 for j,jc in enumerate(rows):
  body+='<w:tr><w:trPr><w:trHeight w:val="500"/>'+ (f'<w:jc w:val="{jc}"/>' if jc else '')+'</w:trPr>'
  for k in range(2):body+=f'<w:tc><w:tcPr><w:tcW w:w="1440" w:type="dxa"/><w:shd w:val="clear" w:fill="{["D0EEDD","EED0DD","D0DDEE"][j]}"/></w:tcPr><w:p><w:r><w:t>T{i}R{j}C{k}</w:t></w:r></w:p></w:tc>'
  body+='</w:tr>'
 body+='</w:tbl>'
body+='<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="1440" w:bottom="720" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts=dict(base);parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}</w:body></w:document>'
from xml.etree import ElementTree as E
E.register_namespace('w',W);E.register_namespace('r',R)
r=E.fromstring(parts['word/document.xml']);ns={'w':W}
table=r.findall('.//w:tbl',ns)[4]
pr=table.find('w:tblPr',ns);pr.insert(0,E.Element('{'+W+'}tblStyle',{'{'+W+'}val':'RowStyle'}))
for row,align in zip(table.findall('w:tr',ns),['end','center']):
 ex=E.Element('{'+W+'}tblPrEx');E.SubElement(ex,'{'+W+'}jc',{'{'+W+'}val':align});row.insert(0,ex)
pr=r.findall('.//w:tbl',ns)[5].find('w:tblPr',ns)
pr.remove(pr.find('w:jc',ns));pr.insert(0,E.Element('{'+W+'}tblStyle',{'{'+W+'}val':'RowStyle'}))
order=['tblStyle','tblW','jc','tblBorders','tblLayout','tblCellMar']
for properties in r.findall('.//w:tblPr',ns):
 properties[:]=sorted(properties,key=lambda child:order.index(child.tag.split('}')[-1]))
parts['word/document.xml']=E.tostring(r,encoding='utf-8',xml_declaration=True)
parts['word/styles.xml']=parts['word/styles.xml'].replace('</w:styles>','<w:style w:type="table" w:styleId="RowStyle"><w:name w:val="RowStyle"/><w:tblPr><w:jc w:val="right"/></w:tblPr><w:trPr><w:jc w:val="start"/></w:trPr></w:style></w:styles>')
ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT/'public/fixtures/table-row-alignment.docx','w',ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
