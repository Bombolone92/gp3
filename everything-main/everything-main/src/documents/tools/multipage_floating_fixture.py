"""Original native controls for numeric multi-page floating-table positions."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from itertools import product
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/multipage-floating';folder.mkdir(exist_ok=True)
repo=Path(__file__).resolve().parents[1]
with ZipFile(repo/'tests/fixtures/cell-end-context/control.docx') as z:base={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
base['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
def para(text):return '<w:p><w:r><w:t>'+text+'</w:t></w:r></w:p>'
for anchor,offset in product(['page','margin','text'],[480,1920]):
 name=f'{anchor}-{offset}'
 pr=f'<w:tblPr><w:tblpPr w:horzAnchor="margin" w:vertAnchor="{anchor}" w:tblpX="1440" w:tblpY="{offset}" w:leftFromText="180" w:rightFromText="180"/><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>'
 rows=''.join('<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="960" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>'+para(f'Row {i:02d}')+'</w:tc></w:tr>' for i in range(18))
 body=para('Before')+'<w:tbl>'+pr+'<w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid>'+rows+'</w:tbl>'+para('Anchor after table')+para('Following paragraph')
 body+='<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
 parts={**base,'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'}
 with ZipFile(folder/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)

from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/multipage-floating';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'
for name in ['page-480','page-1920','margin-480','margin-1920','text-480','text-1920']:
 with ZipFile(folder/(name+'.docx')) as z:parts={n:z.read(n) for n in z.namelist()}
 parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
 r=E.fromstring(parts['word/_rels/document.xml.rels']);E.SubElement(r,'{'+R+'}Relationship',Id='rSettings15',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',Target='settings.xml');parts['word/_rels/document.xml.rels']=E.tostring(r)
 r=E.fromstring(parts['[Content_Types].xml']);E.SubElement(r,'{'+CT+'}Override',PartName='/word/settings.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml');parts['[Content_Types].xml']=E.tostring(r)
 with ZipFile(folder/(name+'-15.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
