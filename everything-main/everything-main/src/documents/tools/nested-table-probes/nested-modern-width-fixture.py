from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
import sys
work=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables'
work.mkdir(parents=True,exist_ok=True)
with ZipFile(work/'nested-clipping-width-half.docx') as z:parts={name:z.read(name) for name in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';C='http://schemas.openxmlformats.org/package/2006/content-types'
types=E.fromstring(parts['[Content_Types].xml'])
E.SubElement(types,'{'+C+'}Override',PartName='/word/settings.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')
parts['[Content_Types].xml']=E.tostring(types,xml_declaration=True,encoding='UTF-8')
parts['word/_rels/document.xml.rels']=f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>'.encode()
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
path=work/'nested-clipping-width-half-15.docx'
with ZipFile(path,'w') as z:
    for name,data in parts.items():
        info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
print(path)

