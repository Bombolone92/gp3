from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import runpy
base=runpy.run_path(str(Path(__file__).with_name('row-padding-probe.py')));p,W=base['p'],base['W'];body=''
for index,(name,rule,header) in enumerate([('exact-plain','exact',False),('exact-header','exact',True),('minimum-plain','atLeast',False),('minimum-header','atLeast',True)]):
 body+=p(name,bool(index));borders=''.join(f'<w:{side} w:val="single" w:sz="24" w:color="008844"/>' for side in ['top','left','bottom','right','insideH'])
 body+=f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid>'
 if header:body+='<w:tr><w:trPr><w:trHeight w:val="480" w:hRule="exact"/><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>'+p(name+' header')+'</w:tc></w:tr>'
 body+=f'<w:tr><w:trPr><w:trHeight w:val="18000" w:hRule="{rule}"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>'+''.join(p(f'{name} line {i:03d}') for i in range(1))+'</w:tc></w:tr></w:tbl>'+p(name+' after')
parts=base['parts'].copy();parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(Path(__file__).with_suffix('.docx'),'w',ZIP_DEFLATED) as z:
 for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
# Independently author the same cases with explicit modern compatibility.
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
parts['word/_rels/document.xml.rels']=f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="{base["R"]}/settings" Target="settings.xml"/></Relationships>'
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
with ZipFile(Path(__file__).with_name('row-oversized-short-modern-probe.docx'),'w',ZIP_DEFLATED) as z:
 for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
