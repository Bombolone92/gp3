"""Original OOXML controls for first-cell paragraph row pagination."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
repo_root=Path(__file__).resolve().parents[1]
out=(repo_root/'tests/fixtures/first-cell-keep');out.mkdir(exist_ok=True)
with ZipFile(repo_root/'tests/fixtures/cell-end-context/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
for name,keep in [('none',-1),('left',0),('middle',1),('right',2)]:
 def para(text,k=False):return '<w:p><w:pPr>'+('<w:keepNext/>' if k else '')+'</w:pPr><w:r>'+''.join(('<w:br/>' if i else '')+'<w:t>'+t+'</w:t>' for i,t in enumerate(text.split('|')))+'</w:r></w:p>'
 cells=''.join('<w:tc><w:tcPr><w:tcW w:w="3120" w:type="dxa"/></w:tcPr>'+para(text,keep==i)+'</w:tc>' for i,text in enumerate(['Heading','Spacer','Line 1|Line 2|Line 3|Line 4|Line 5|Line 6']))
 body='<w:p><w:pPr><w:spacing w:line="11800" w:lineRule="exact"/></w:pPr><w:r><w:t>Filler '+name+'</w:t></w:r></w:p>'
 body+='<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'+('<w:gridCol w:w="3120"/>'*3)+'</w:tblGrid><w:tr>'+cells+'</w:tr></w:tbl>'+para('After table')
 body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
 parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
 with ZipFile(out/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)

from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ns={'w':W}
folder=(repo_root/'tests/fixtures/first-cell-keep')
with ZipFile(folder/'none.docx') as z:base={n:z.read(n) for n in z.namelist()}
def p(text,keep):
 e=E.Element('{'+W+'}p');pr=E.SubElement(e,'{'+W+'}pPr')
 if keep:E.SubElement(pr,'{'+W+'}keepNext')
 r=E.SubElement(e,'{'+W+'}r');E.SubElement(r,'{'+W+'}t').text=text
 return e
cases={'first-only':[("Heading",True),("Tail",False)],'last-only':[("Heading",False),("Tail",True)],'all-left':[("Heading",True),("Tail",True)],'empty-left':[("",True)],'empty-first-off':[("",False),("Heading",True)]}
for name,pars in cases.items():
 root=E.fromstring(base['word/document.xml']);cell=root.find('.//w:tc',ns)
 for e in cell.findall('w:p',ns):cell.remove(e)
 for text,k in pars:cell.append(p(text,k))
 parts={**base,'word/document.xml':E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)}
 with ZipFile(folder/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)

from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import copy
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ns={'w':W};folder=(repo_root/'tests/fixtures/first-cell-keep')
for name,source,kind in [('two-rows','left','two'),('two-rows-off','none','two'),('oversized','left','long'),('merge-first','left','merge')]:
 with ZipFile(folder/(source+'.docx')) as z:parts={n:z.read(n) for n in z.namelist()}
 root=E.fromstring(parts['word/document.xml']);table=root.find('.//w:tbl',ns);row=table.find('w:tr',ns);cells=row.findall('w:tc',ns)
 if kind=='two':
  new=copy.deepcopy(row)
  for c in new.findall('w:tc',ns):
   for k in c.findall('.//w:keepNext',ns):k.getparent().remove(k)
  for r in cells[2].findall('w:p/w:r',ns):
   for e in list(r):r.remove(e)
   E.SubElement(r,'{'+W+'}t').text='Short'
  table.append(new)
 elif kind=='long':
  r=cells[2].find('w:p/w:r',ns)
  for i in range(60):
   E.SubElement(r,'{'+W+'}br');E.SubElement(r,'{'+W+'}t').text='Extra '+str(i)
 else:
  E.SubElement(cells[0].find('w:tcPr',ns),'{'+W+'}gridSpan').set('{'+W+'}val','2')
  cells[0].find('w:tcPr/w:tcW',ns).set('{'+W+'}w','6240');row.remove(cells[1])
 parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
 with ZipFile(folder/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
