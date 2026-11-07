"""Original OPC/XML controls for retained empty header/footer variants."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1];W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';REL='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types';TYPE='application/vnd.openxmlformats-officedocument.wordprocessingml.'
q=lambda n:'{'+W+'}'+n
with ZipFile(root/'tests/fixtures/page-stories/footer-variants.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);section=doc.find('.//'+q('sectPr'));rels=E.fromstring(parts['word/_rels/document.xml.rels']);types=E.fromstring(parts['[Content_Types].xml'])
for p in doc.iter(q('p')):E.SubElement(p.find(q('pPr')),q('pStyle'),{q('val'):'Shared'})
# pStyle precedes the existing page-break property.
for pr in doc.iter(q('pPr')):
 style=pr.find(q('pStyle'));pr.remove(style);pr.insert(0,style)
for kind in ['header','footer']:
 for variant in ['default','first','even']:
  path=f'word/{kind}-{variant}.xml';tag='hdr' if kind=='header' else 'ftr'
  parts[path]=f'<w:{tag} xmlns:w="{W}"><w:p><w:pPr><w:pStyle w:val="Shared"/></w:pPr></w:p></w:{tag}>'.encode()
  if kind=='header':
   section.insert(0,E.Element(q('headerReference'),{q('type'):variant,'{'+R+'}id':kind+variant}))
   E.SubElement(rels,'{'+REL+'}Relationship',Id=kind+variant,Type=R+'/'+kind,Target=f'{kind}-{variant}.xml')
   E.SubElement(types,'{'+CT+'}Override',PartName='/'+path,ContentType=TYPE+kind+'+xml')
parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:styleId="Shared"><w:name w:val="Shared"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:style></w:styles>'.encode()
E.SubElement(rels,'{'+REL+'}Relationship',Id='styles',Type=R+'/styles',Target='styles.xml');E.SubElement(types,'{'+CT+'}Override',PartName='/word/styles.xml',ContentType=TYPE+'styles+xml')
for name,r in [('word/document.xml',doc),('word/_rels/document.xml.rels',rels),('[Content_Types].xml',types)]:parts[name]=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(root/'public/fixtures/empty-page-stories.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
parts['word/styles.xml']=parts['word/styles.xml'].replace(b'<w:spacing',b'<w:shd w:val="clear" w:fill="22AA88"/><w:spacing')
with ZipFile(root/'public/fixtures/empty-page-stories-shaded.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
