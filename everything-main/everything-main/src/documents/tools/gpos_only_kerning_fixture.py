from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1];W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';W14='http://schemas.microsoft.com/office/word/2010/wordml';MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
with ZipFile(root/'public/fixtures/reviewed-font.docx') as z:parts={n:z.read(n) for n in z.namelist()}
ct=E.fromstring(parts['[Content_Types].xml']);E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/word/settings.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml');parts['[Content_Types].xml']=E.tostring(ct)
rn='word/_rels/document.xml.rels';rels=E.fromstring(parts[rn]);E.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id='rIdKernSettings',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',Target='settings.xml');parts[rn]=E.tostring(rels)
for mode in [None,False,True]:
 for lig in ['none','standard']:
  name=f'gpos-kern-{mode}-{lig}';document=E.Element('{'+W+'}document',nsmap={'w':W,'w14':W14,'mc':MC});document.set('{'+MC+'}Ignorable','w14');body=E.SubElement(document,'{'+W+'}body')
  for family in ['Bebas Neue','Arial']:
   for kern in [0,2]:
    p=E.SubElement(body,'{'+W+'}p');pp=E.SubElement(p,'{'+W+'}pPr');sp=E.SubElement(pp,'{'+W+'}spacing');sp.set('{'+W+'}after','240');sp.set('{'+W+'}line','240');sp.set('{'+W+'}lineRule','auto');r=E.SubElement(p,'{'+W+'}r');rp=E.SubElement(r,'{'+W+'}rPr');f=E.SubElement(rp,'{'+W+'}rFonts');f.set('{'+W+'}ascii',family);f.set('{'+W+'}hAnsi',family)
    for tag,val in [('sz','36'),('kern',str(kern))]:E.SubElement(rp,'{'+W+'}'+tag).set('{'+W+'}val',val)
    E.SubElement(rp,'{'+W14+'}ligatures').set('{'+W14+'}val',lig);E.SubElement(r,'{'+W+'}t').text='AVATAR BETA DELTA To Wa fi fl'
  sec=E.SubElement(body,'{'+W+'}sectPr');sz=E.SubElement(sec,'{'+W+'}pgSz');sz.set('{'+W+'}w','12240');sz.set('{'+W+'}h','15840');mar=E.SubElement(sec,'{'+W+'}pgMar')
  for key,val in [('top',720),('bottom',720),('left',720),('right',720),('header',360),('footer',360),('gutter',0)]:mar.set('{'+W+'}'+key,str(val))
  data=parts.copy();data['word/document.xml']=E.tostring(document);settings=E.Element('{'+W+'}settings',nsmap={'w':W});comp=E.SubElement(settings,'{'+W+'}compat')
  if mode is not None:
   el=E.SubElement(comp,'{'+W+'}compatSetting');el.set('{'+W+'}name','enableOpenTypeFeatures');el.set('{'+W+'}uri','http://schemas.microsoft.com/office/word');el.set('{'+W+'}val','1' if mode else '0')
  data['word/settings.xml']=E.tostring(settings)
  with ZipFile((root/'tests/fixtures/gpos-only-kerning')/(name+'.docx'),'w',ZIP_DEFLATED) as z:
   for n,b in data.items():z.writestr(n,b)

# A second unrelated GPOS-only family verifies that this is not a face-name rule.
for mode in [False,True]:
 src=root/'tests/fixtures/gpos-only-kerning'/f'gpos-kern-{mode}-none.docx'
 with ZipFile(src) as z:data={n:z.read(n) for n in z.namelist()}
 data['word/document.xml']=data['word/document.xml'].replace(b'Bebas Neue',b'Source Sans Pro')
 with ZipFile(src.with_name(f'source-sans-kern-{mode}-none.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in data.items():z.writestr(n,b)

# Independent regular/bold/italic/bold-italic synthesis controls.
for mode in [False,True]:
 src=(root/'tests/fixtures/gpos-only-kerning')/f'gpos-kern-{mode}-none.docx';dst=(root/'tests/fixtures/gpos-only-kerning')/f'gpos-style-{mode}-none.docx'
 with ZipFile(src) as z:parts={n:z.read(n) for n in z.namelist()}
 doc=E.fromstring(parts['word/document.xml'])
 for i,r in enumerate(doc.findall('.//{'+W+'}r')):
  pr=r.find('{'+W+'}rPr');font=pr.find('{'+W+'}rFonts')
  for key in ['ascii','hAnsi']:font.set('{'+W+'}'+key,'Bebas Neue')
  pr.find('{'+W+'}kern').set('{'+W+'}val','2')
  if i in [1,3]:E.SubElement(pr,'{'+W+'}b')
  if i in [2,3]:E.SubElement(pr,'{'+W+'}i')
 parts['word/document.xml']=E.tostring(doc)
 with ZipFile(dst,'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
