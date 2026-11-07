"""Independent OOXML probes for intersecting exact-height nested cell clips."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import sys
work=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables'
work.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def p(text):
    return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/><w:sz w:val="20"/></w:rPr><w:t>{text}</w:t></w:r></w:p>'
def table(content,width,height,color,vertical=None):
    borders=''.join(f'<w:{side} w:val="single" w:sz="8" w:color="{color}"/>' for side in ['top','left','bottom','right'])
    margins=''.join(f'<w:{side} w:w="60" w:type="dxa"/>' for side in ['top','left','bottom','right'])
    fixed=f'<w:trHeight w:val="{height}" w:hRule="exact"/>' if height else ''
    alignment=f'<w:vAlign w:val="{vertical}"/>' if vertical else ''
    return f'<w:tbl><w:tblPr><w:tblW w:w="{width}" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="{width}"/></w:tblGrid><w:tr><w:trPr>{fixed}</w:trPr><w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/><w:shd w:val="clear" w:fill="{color}"/>{alignment}</w:tcPr>{content}</w:tc></w:tr></w:tbl>'
for mode in ['inner-exact','outer-exact','both-exact','deep','center','bottom']:
    content=''.join(p(f'Inner line {i}') for i in range(1,7))
    if mode=='deep':content=table(content,2400,480,'B4D7FF')+p('Middle terminal')
    inner=table(content,3600,480 if mode in ['inner-exact','both-exact','center','bottom'] else 0,'C9E7B5')
    outer=table(p('Outer before')+inner+p('Outer after'),4800,720 if mode in ['outer-exact','both-exact'] else 2400,'FFF1A8',mode if mode in ['center','bottom'] else None)
    parts={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels':f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':f'<w:document xmlns:w="{W}"><w:body>'+p('Nested clipping '+mode)+outer+p('After outer table')+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    }
    path=work/f'nested-clipping-{mode}.docx'
    with ZipFile(path,'w') as z:
        for name,xml in parts.items():
            info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED
            z.writestr(info,'<?xml version="1.0" encoding="UTF-8"?>'+xml)
    print(path)
