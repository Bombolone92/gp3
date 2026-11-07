from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import runpy
base=runpy.run_path(str(Path(__file__).with_name('row-padding-probe.py')))
p,W=base['p'],base['W'];body=''
# Margins in twips: owner, continuation, ordinary cells. No borders isolate padding.
cases=[('merge-zero',(0,0),(0,0),(0,0)),('merge-owner',(400,600),(0,0),(0,0)),('merge-continuation',(0,0),(800,1000),(0,0)),('merge-ordinary',(0,0),(0,0),(200,200)),('merge-combined',(400,600),(800,1000),(200,200))]
for index,(name,owner,continuation,ordinary) in enumerate(cases):
    body+=p(name,bool(index))+'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2160"/><w:gridCol w:w="2160"/></w:tblGrid>'
    for row in range(2):
        body+='<w:tr>'+('<w:trPr><w:trHeight w:val="1440" w:hRule="atLeast"/></w:trPr>' if row==0 else '')
        for col in range(2):
            top,bottom=ordinary if col else continuation if row else owner
            merge=('<w:vMerge/>' if row else '<w:vMerge w:val="restart"/>') if col==0 else ''
            body+=f'<w:tc><w:tcPr><w:tcW w:w="2160" w:type="dxa"/>{merge}<w:tcMar><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/></w:tcMar></w:tcPr>'+p(('Probe first' if row==0 else 'Probe second') if col else ('Merged owner' if row==0 else ''))+'</w:tc>'
        body+='</w:tr>'
    body+='</w:tbl>'+p(name+' after')
parts=base['parts'].copy();parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(Path(__file__).with_suffix('.docx'),'w',ZIP_DEFLATED) as z:
    for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
