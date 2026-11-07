from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import runpy
base=runpy.run_path(str(Path(__file__).with_name('row-padding-probe.py')));p,W=base['p'],base['W'];body=''
for index,(name,rule) in enumerate([('minimum','atLeast'),('exact','exact')]):
    body+=p(name+' table',bool(index))
    borders=''.join(f'<w:{side} w:val="single" w:sz="24" w:color="008844"/>' for side in ['top','left','bottom','right','insideH'])
    body+=f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid>'
    for row in range(41):
        props=f'<w:trPr><w:trHeight w:val="720" w:hRule="{rule}"/><w:tblHeader/></w:trPr>' if not row else ''
        cellprops='<w:vAlign w:val="center"/>' if not row else ''
        body+='<w:tr>'+props+'<w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/>'+cellprops+'</w:tcPr>'+p(name+' header' if not row else f'{name} row {row:02d}')+'</w:tc></w:tr>'
    body+='</w:tbl>'+p(name+' after')
parts=base['parts'].copy();parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(Path(__file__).with_suffix('.docx'),'w',ZIP_DEFLATED) as z:
    for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
