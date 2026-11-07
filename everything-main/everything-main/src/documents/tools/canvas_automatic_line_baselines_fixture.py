"""Independent OOXML probes for baseline placement with automatic line spacing."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from canvas_first_section_fixture import parts as shell, W

parts = dict(shell)
parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Century Schoolbook" w:hAnsi="Century Schoolbook"/><w:sz w:val="60"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>'
body = ''
for face, size in [('Century Schoolbook', 30), ('Century Gothic', 10)]:
    run = f'<w:rPr><w:rFonts w:ascii="{face}" w:hAnsi="{face}"/><w:sz w:val="{size * 2}"/></w:rPr>'
    for line in [120, 180, 240, 250, 360, 480]:
        page = '<w:pageBreakBefore/>' if body else ''
        body += f'<w:p><w:pPr>{page}{run}</w:pPr><w:r>{run}<w:t>Lead</w:t></w:r></w:p>'
        body += f'<w:p><w:pPr><w:spacing w:line="{line}" w:lineRule="auto"/>{run}</w:pPr><w:r>{run}<w:t>Alpha</w:t><w:br/><w:t>Beta</w:t></w:r></w:p>'
        body += f'<w:p><w:pPr>{run}</w:pPr><w:r>{run}<w:t>After</w:t></w:r></w:p>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'

if __name__ == '__main__':
    path = Path(__file__).resolve().parents[1] / 'public/fixtures/automatic-line-baselines.docx'
    with ZipFile(path, 'w', ZIP_DEFLATED) as z:
        for name, text in parts.items():
            z.writestr(name, text)
    print(path)
