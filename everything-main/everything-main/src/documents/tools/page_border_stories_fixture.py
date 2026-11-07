"""Original two-page controls for header/footer page-border inclusion."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/page-borders'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';REL='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'
with ZipFile(folder/'control.docx') as z:base={n:z.read(n) for n in z.namelist()}
for mode,flags in [('stories',[]),('exclude-header',['bordersDoNotSurroundHeader']),('exclude-footer',['bordersDoNotSurroundFooter']),('exclude-both',['bordersDoNotSurroundHeader','bordersDoNotSurroundFooter'])]:
 parts=dict(base);d=E.fromstring(parts['word/document.xml']);body=d.find('{'+W+'}body');ps=body.findall('{'+W+'}p');first,second=ps[12],ps[13];section=second.find('.//{'+W+'}sectPr');section.getparent().remove(section)
 for n in list(body):body.remove(n)
 body.extend([first,second,section]);rs=E.fromstring(parts['word/_rels/document.xml.rels']);ts=E.fromstring(parts['[Content_Types].xml'])
 for kind,tag in [('header','hdr'),('footer','ftr')]:
  section.insert(0,E.Element('{'+W+'}'+kind+'Reference',{'{'+W+'}type':'default','{'+R+'}id':kind}))
  parts['word/'+kind+'.xml']=f'<w:{tag} xmlns:w="{W}"><w:p><w:r><w:t>{kind.upper()}</w:t></w:r></w:p></w:{tag}>'.encode()
  E.SubElement(rs,'{'+REL+'}Relationship',Id=kind,Type=R+'/'+kind,Target=kind+'.xml');E.SubElement(ts,'{'+CT+'}Override',PartName='/word/'+kind+'.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.'+kind+'+xml')
 # The original OPC skeleton has no settings relationship.
 E.SubElement(rs,'{'+REL+'}Relationship',Id='settings',Type=R+'/settings',Target='settings.xml');E.SubElement(ts,'{'+CT+'}Override',PartName='/word/settings.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')
 parts['word/settings.xml']=(f'<w:settings xmlns:w="{W}">'+''.join(f'<w:{flag}/>' for flag in flags)+'</w:settings>').encode()
 parts['word/document.xml']=E.tostring(d);parts['word/_rels/document.xml.rels']=E.tostring(rs);parts['[Content_Types].xml']=E.tostring(ts)
 with ZipFile(folder/(mode+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
