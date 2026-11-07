from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import runpy
base=runpy.run_path(str(Path(__file__).with_name('row-padding-probe.py')));p,W=base['p'],base['W'];body=''
cases=[('minimum36-kept','atLeast',720,True),('minimum39-kept','atLeast',780,True),('minimum39-split','atLeast',780,False),('minimum42-split','atLeast',840,False),('exact36-kept','exact',720,True),('exact48-kept','exact',960,True)]
for index,(name,rule,height,kept) in enumerate(cases):
    body+=p(name,bool(index)).replace('w:line="240"','w:line="12000"')
    borders=''.join(f'<w:{side} w:val="single" w:sz="48" w:color="00AA00"/>' for side in ['top','left','bottom','right'])
    body+=f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="{rule}"/>'+('<w:cantSplit/>' if kept else '')+'</w:trPr><w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>'+p(name+' row')+'</w:tc></w:tr></w:tbl>'+p(name+' after')
parts=base['parts'].copy();parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(Path(__file__).with_suffix('.docx'),'w',ZIP_DEFLATED) as z:
    for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
