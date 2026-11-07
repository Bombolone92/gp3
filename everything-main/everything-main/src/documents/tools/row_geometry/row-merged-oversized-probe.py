from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import runpy
base=runpy.run_path(str(Path(__file__).with_name('row-padding-probe.py')));p,W,R=base['p'],base['W'],base['R']
borders=''.join(f'<w:{s} w:val="single" w:sz="24" w:color="008844"/>' for s in ['top','left','bottom','right','insideH','insideV'])
def cell(text,props='',width=2160):return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>'+props+'</w:tcPr>'+text+'</w:tc>'
body=p('Merged minimum')+f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2160"/><w:gridCol w:w="2160"/></w:tblGrid>'
body+='<w:tr><w:trPr><w:trHeight w:val="480" w:hRule="exact"/><w:tblHeader/></w:trPr>'+cell(p('Header'),'<w:gridSpan w:val="2"/>',4320)+'</w:tr>'
body+='<w:tr><w:trPr><w:trHeight w:val="18000" w:hRule="atLeast"/></w:trPr>'+cell(''.join(p(f'Left {i:03d}') for i in range(85)),'<w:vMerge w:val="restart"/>')+cell(p('Right first'))+'</w:tr>'
body+='<w:tr>'+cell(p(''),'<w:vMerge/>')+cell(p('Right second'))+'</w:tr>'
body+='<w:tr>'+cell(p('Trailing'),'<w:gridSpan w:val="2"/>',4320)+'</w:tr></w:tbl>'+p('After table')
parts=base['parts'].copy();parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
parts['word/_rels/document.xml.rels']=f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>'
for mode in [14,15]:
 parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
 with ZipFile(Path(__file__).with_name(f'row-merged-oversized-{mode}-probe.docx'),'w',ZIP_DEFLATED) as z:
  for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
