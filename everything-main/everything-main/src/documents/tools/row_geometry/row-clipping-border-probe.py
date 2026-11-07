from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import runpy
base=runpy.run_path(str(Path(__file__).with_name('row-padding-probe.py')));p,W=base['p'],base['W'];body=''
cases=[('no-border',0,0,0),('half-border',4,0,0),('three-border',24,0,0),('six-border',48,0,0),('six-border-padding',48,100,0),('three-border-padding',24,100,0),('six-border-top',48,0,100),('six-border-both',48,100,100)]
for index,(name,size,bottom,top) in enumerate(cases):
    body+=p(name,bool(index))
    borders=''.join(f'<w:{side} w:val="{ "single" if size else "nil" }" w:sz="{size}" w:color="008844"/>' for side in ['top','left','bottom','right'])
    body+=f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="360" w:hRule="exact"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/></w:tcPr>'
    body+='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="720" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:color w:val="FF0000"/><w:sz w:val="48"/></w:rPr><w:t>MMMM</w:t></w:r></w:p>'
    body+='</w:tc></w:tr></w:tbl>'+p(name+' after')
parts=base['parts'].copy();parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
with ZipFile(Path(__file__).with_suffix('.docx'),'w',ZIP_DEFLATED) as z:
    for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
