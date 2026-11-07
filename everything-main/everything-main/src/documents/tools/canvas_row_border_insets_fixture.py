"""Independent XML probes for row border writing insets and shared painted edges."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as shell, W

def build(cases, path):
    parts=dict(shell)
    parts['word/styles.xml']=f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
    body=''
    for omitted,size,topSize in cases:
        page='<w:pageBreakBefore/>' if body else ''
        body+=f'<w:p><w:pPr>{page}</w:pPr><w:r><w:t>Lead</w:t></w:r></w:p>'
        border=lambda edge:f'<w:{edge} w:val="single" w:sz="{size}" w:color="FF0000"/>' if size else ''
        body+='<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="9350"/><w:gridCol w:w="10"/></w:tblGrid>'
        for i,text in enumerate(['Header','Body','Last']):
            omission='<w:gridAfter w:val="1"/><w:wAfter w:w="10" w:type="dxa"/>' if omitted and i==0 else ''
            height='<w:trHeight w:val="720"/>' if i==0 else ''
            span='' if omitted and i==0 else '<w:gridSpan w:val="2"/>'
            width=9350 if omitted and i==0 else 9360
            valign='<w:vAlign w:val="bottom"/>' if i==0 else ''
            borders=(border('top') if i==2 else '')+border('bottom')
            if i==1 and topSize: borders=(f'<w:top w:val="single" w:sz="{topSize}" w:color="0000FF"/>' if topSize>0 else '<w:top w:val="nil"/>')+borders
            body+=f'<w:tr><w:trPr>{omission}{height}</w:trPr><w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{span}<w:tcBorders>{borders}</w:tcBorders>{valign}</w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc></w:tr>'
        body+='</w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p>'
    parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,text in parts.items(): z.writestr(name,text)

if __name__ == '__main__':
    root=Path(__file__).resolve().parents[1]/'public/fixtures'
    build([(omitted,size,0) for omitted in [False,True] for size in [0,8,16]],root/'row-border-insets.docx')
    build([(False,size,top) for size in [8,16] for top in [0,4,8,16,24,-1]],root/'row-border-opposition.docx')
