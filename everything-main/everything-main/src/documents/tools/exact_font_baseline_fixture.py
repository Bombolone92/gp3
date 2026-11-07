"""Original font/line-height matrix to measure native exact-line baselines."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
with ZipFile(root / 'public/fixtures/reviewed-font.docx') as z:
    parts = {name: z.read(name) for name in z.namelist()}
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
paragraphs = []
for family in ['Arial', 'Times New Roman', 'Courier New', 'Bebas Neue']:
    for size in [12, 24]:
        for height in [12, 24, 36]:
            font = f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/><w:sz w:val="{size*2}"/>'
            page_break = '<w:pageBreakBefore/>' if size == 12 and height == 12 and paragraphs else ''
            text = f'{family} SIZE {size} EXACT {height}'
            paragraphs.append(f'<w:p><w:pPr>{page_break}<w:spacing w:before="0" w:after="240" w:line="{height*20}" w:lineRule="exact"/><w:rPr>{font}</w:rPr></w:pPr><w:r><w:rPr>{font}</w:rPr><w:t>{text}</w:t></w:r></w:p>')
section = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{"".join(paragraphs)}{section}</w:body></w:document>'.encode()
with ZipFile(root / 'public/fixtures/exact-font-baseline.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
