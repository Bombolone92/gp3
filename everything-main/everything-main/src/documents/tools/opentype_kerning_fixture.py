"""Original four-font controls for OpenType/legacy kerning interaction."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
for prefix, uri in [('w', W), ('w14', W14), ('mc', MC)]: E.register_namespace(prefix, uri)
def node(parent, tag, **attrs):
 return E.SubElement(parent, '{'+W+'}'+tag, {'{'+W+'}'+k:str(v) for k,v in attrs.items()})
with ZipFile(ROOT/'public/fixtures/exhausted-cell-indents.docx') as z:
 base = {n:z.read(n) for n in z.namelist()}
rels = E.fromstring(base['word/_rels/document.xml.rels'])
E.SubElement(rels, '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship', Id='settings', Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', Target='settings.xml')
base['word/_rels/document.xml.rels'] = E.tostring(rels)
ct = E.fromstring(base['[Content_Types].xml'])
E.SubElement(ct, '{http://schemas.openxmlformats.org/package/2006/content-types}Override', PartName='/word/settings.xml', ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')
base['[Content_Types].xml'] = E.tostring(ct)
for enabled in [0, 1]:
 parts = base.copy()
 doc = E.Element('{'+W+'}document', {'{'+MC+'}Ignorable':'w14'})
 body = node(doc, 'body')
 for family in ['Goudy Old Style','Times New Roman','Arial','Calibri']:
  for text in ['0123456789','1111111111','AVATAR To Wa','A1V1T1A','1A1V1T1','01 12 24','0.1,2-4','(423) 555-0124']:
   p=node(body,'p'); pp=node(p,'pPr'); node(pp,'spacing',after=0); node(pp,'jc',val='right')
   r=node(p,'r'); rp=node(r,'rPr'); node(rp,'rFonts',ascii=family,hAnsi=family)
   node(rp,'kern',val=2); node(rp,'sz',val=24)
   E.SubElement(rp,'{'+W14+'}ligatures',{'{'+W14+'}val':'standardContextual'})
   node(r,'t').text=text
 sect=node(body,'sectPr'); node(sect,'pgSz',w=12240,h=15840)
 node(sect,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0)
 settings=E.Element('{'+W+'}settings'); compat=node(settings,'compat')
 node(compat,'compatSetting',name='compatibilityMode',uri='http://schemas.microsoft.com/office/word',val=15)
 node(compat,'compatSetting',name='enableOpenTypeFeatures',uri='http://schemas.microsoft.com/office/word',val=enabled)
 parts['word/document.xml']=E.tostring(doc); parts['word/settings.xml']=E.tostring(settings)
 with ZipFile(ROOT/f'public/fixtures/opentype-kerning-{enabled}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items(): z.writestr(n,b)
