"""Original OPC controls for bookmark scope within temporary inline SDTs."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/temporary-control-bookmarks'
root.mkdir(parents=True, exist_ok=True)
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
cases = ['interior', 'boundary', 'point', 'hyperlink', 'crossing', 'placeholder', 'placeholder_inner', 'placeholder_crossing', 'placeholder_overlap']
paragraphs = []
for i, case in enumerate(cases):
    start = f'<w:bookmarkStart w:id="{i}" w:name="Mark_{case}"/>'
    end = f'<w:bookmarkEnd w:id="{i}"/>'
    run = lambda text: f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'
    before = run(case + ': before ')
    if case in ['boundary', 'placeholder']:
        contents = start + run('Alpha beta') + end
    elif case == 'point':
        contents = run('Al') + start + end + run('pha beta')
    elif case in ['crossing', 'placeholder_crossing', 'placeholder_overlap']:
        before = run(case + ': be') + start + run('fore ') if case == 'placeholder_overlap' else before + start
        contents = run('Alpha') + end + run(' beta')
    else:
        contents = run('Al') + start + run('pha be') + end + run('ta')
        if case == 'hyperlink':
            contents = f'<w:hyperlink w:anchor="Mark_boundary">{contents}</w:hyperlink>'
    props = f'<w:alias w:val="{case}"/><w:id w:val="{100+i}"/><w:temporary/>'
    if case.startswith('placeholder'):
        props += '<w:showingPlcHdr/>'
    props += '<w:richText/>'
    paragraphs.append('<w:p>' + before + '<w:sdt><w:sdtPr>' + props + '</w:sdtPr><w:sdtContent>' + contents + '</w:sdtContent></w:sdt>' + run(' after') + '</w:p>')
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="{r}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="{r}/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': f'<w:styles xmlns:w="{w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
    'word/document.xml': f'<w:document xmlns:w="{w}"><w:body>{"".join(paragraphs)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
with ZipFile(root / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, value in parts.items():
        z.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + value)
print(root / 'control.docx')
