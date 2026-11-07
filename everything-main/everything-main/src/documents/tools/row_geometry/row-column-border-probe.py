from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import runpy
base=runpy.run_path(str(Path(__file__).with_name('row-padding-probe.py')));p,W=base['p'],base['W'];body=''
cases=[('top-wide-left',(48,8),(8,8)),('bottom-wide-left',(8,8),(48,8)),('bottom-wide-right',(8,8),(8,48)),('opposite-wide-edges',(24,8),(8,48))]
for index,(name,tops,bottoms) in enumerate(cases):
    body+=p(name,bool(index))+'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2160"/><w:gridCol w:w="2160"/></w:tblGrid>'
    for row in range(2):
        body+='<w:tr>'+('<w:trPr><w:trHeight w:val="1440" w:hRule="atLeast"/></w:trPr>' if not row else '')
        for col in range(2):
            top=tops[col] if not row else 8;bottom=bottoms[col] if not row else 8
            edges=''.join(f'<w:{side} w:val="single" w:sz="{size}" w:color="00AA00"/>' for side,size in [('top',top),('bottom',bottom)])
            body+=f'<w:tc><w:tcPr><w:tcW w:w="2160" w:type="dxa"/><w:tcBorders>{edges}</w:tcBorders></w:tcPr>'+p(('Probe first' if not row else 'Probe second') if not col else ('Other first' if not row else 'Other second'))+'</w:tc>'
        body+='</w:tr>'
    body+='</w:tbl>'+p(name+' after')
parts=base['parts'].copy();parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(Path(__file__).with_suffix('.docx'),'w',ZIP_DEFLATED) as z:
    for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
