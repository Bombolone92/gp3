from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def p(text,br=False):return '<w:p><w:pPr>'+('<w:pageBreakBefore/>' if br else '')+'<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:sz w:val="20"/></w:rPr><w:t>'+text+'</w:t></w:r></w:p>'
cases=[('min-none','atLeast',0,0,4),('min-top','atLeast',144,0,4),('min-bottom','atLeast',0,144,4),('min-both','atLeast',144,144,4),('min-no-border','atLeast',144,144,0),('exact-both','exact',144,144,4),('exact-no-border','exact',144,144,0),('auto-both','auto',144,144,4),('auto-no-border','auto',144,144,0)]
cases += [('min-asymmetric','atLeast',0,0,4),('auto-asymmetric','auto',0,0,4),('min-cellsum','atLeast',0,0,4)]
body=''
for i,(name,rule,top,bottom,size) in enumerate(cases):
    body+=p(name,bool(i))
    borders=''.join(f'<w:{side} w:val="{ "single" if size else "nil" }" w:sz="{size}" w:color="000000"/>' for side in ['top','left','bottom','right','insideH','insideV'])
    margin=f'<w:top w:w="{top}" w:type="dxa"/><w:left w:w="144" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:right w:w="144" w:type="dxa"/>'
    split=name in ['min-asymmetric','auto-asymmetric','min-cellsum']
    grid='<w:gridCol w:w="2160"/><w:gridCol w:w="2160"/>' if split else '<w:gridCol w:w="4320"/>'
    body+=f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margin}</w:tblCellMar></w:tblPr><w:tblGrid>{grid}</w:tblGrid>'
    for index,label in enumerate(['first','second']):
        height=f'<w:trPr><w:trHeight w:val="1440" w:hRule="{rule}"/></w:trPr>' if not index else ''
        body+=f'<w:tr>{height}'
        for column in range(2 if split else 1):
            width=2160 if split else 4320
            cellmargin=''
            if split:
                t,b=(144,144 if name=='min-cellsum' else 0) if column==0 else (0,288)
                cellmargin=f'<w:tcMar><w:top w:w="{t}" w:type="dxa"/><w:bottom w:w="{b}" w:type="dxa"/></w:tcMar>'
            body+=f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{cellmargin}</w:tcPr>'+p('Probe '+label if not column else 'Other cell '+str(index))+'</w:tc>'
        body+='</w:tr>'
    body+='</w:tbl>'+p(name+' after')
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>', 'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+body+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'}
path=Path(__file__).resolve().parent/'row-padding-probe.docx'
with ZipFile(path,'w',ZIP_DEFLATED) as z:
    for name,xml in parts.items():z.writestr(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
print(path)
