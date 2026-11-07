from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from xml.etree import ElementTree as E
root=Path(__file__).parent;W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ns={'w':W};E.register_namespace('w',W)
with ZipFile(root/'row-oversized-short-modern-probe.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('w:body',ns);children=list(body);table=body.findall('w:tbl',ns)[3];index=children.index(table);keep=[children[index-1],table,children[index+1],body.find('w:sectPr',ns)]
body[:]=keep;heading=keep[0].find('w:pPr/w:pageBreakBefore',ns)
if heading is not None:keep[0].find('w:pPr',ns).remove(heading)
rows=table.findall('w:tr',ns);rows[0].find('w:trPr/w:trHeight',ns).set('{'+W+'}val','10000')
rows[1].find('w:tc/w:p/w:pPr/w:spacing',ns).set('{'+W+'}line','6000')
parts['word/document.xml']=E.tostring(doc,encoding='utf-8',xml_declaration=True)
with ZipFile(root/'row-header-clearance-probe.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
