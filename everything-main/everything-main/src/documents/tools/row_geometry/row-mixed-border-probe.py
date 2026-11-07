from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import runpy
base=runpy.run_path(str(Path(__file__).with_name('row-padding-probe.py')))
p,W=base['p'],base['W']
cases=[('top6-inside1-bottom3','single',48,8,24,None),('top1-inside6-bottom3','single',8,48,24,None),('top3-inside1-bottom6','single',24,8,48,None),('double3','double',24,24,24,None),('triple3','triple',24,24,24,None),('dotted3','dotted',24,24,24,None),('thick3','thick',24,24,24,None),('conflict-upper6','single',8,8,8,(48,8)),('conflict-lower6','single',8,8,8,(8,48)),('conflict-nil','single',8,8,8,(0,48))]
body=''
for i,(name,style,top,inside,bottom,conflict) in enumerate(cases):
    body+=p(name,bool(i))
    borders=''.join(f'<w:{side} w:val="{style}" w:sz="{size}" w:color="{color}"/>' for side,size,color in [('top',top,'FF0000'),('left',8,'000000'),('bottom',bottom,'0000FF'),('right',8,'000000'),('insideH',inside,'00FF00')])
    body+=f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid>'
    for index,label in enumerate(['first','second']):
        height='<w:trPr><w:trHeight w:val="1440" w:hRule="atLeast"/></w:trPr>' if not index else ''
        direct=''
        if conflict is not None:
            side='bottom' if not index else 'top'; size=conflict[index]
            direct=f'<w:tcBorders><w:{side} w:val="{ "single" if size else "nil" }" w:sz="{size}" w:color="00FF00"/></w:tcBorders>'
        body+=f'<w:tr>{height}<w:tc><w:tcPr><w:tcW w:w="4320" w:type="dxa"/>{direct}</w:tcPr>'+p('Probe '+label)+'</w:tc></w:tr>'
    body+='</w:tbl>'+p(name+' after')
parts=base['parts'].copy()
parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
path=Path(__file__).with_suffix('.docx')
with ZipFile(path,'w',ZIP_DEFLATED) as z:
    for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
print(path)
