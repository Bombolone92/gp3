"""Original saved-content controls in immutable header/footer parts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
with ZipFile(root / 'public/fixtures/square-wrap-footer-modern.docx') as z:
    parts = {n: z.read(n) for n in ['[Content_Types].xml', '_rels/.rels', 'word/styles.xml', 'word/settings.xml', 'word/media/square.png']}
    picture = E.tostring(E.fromstring(z.read('word/footer-case0.xml')).find('.//{%s}r[{%s}drawing]' % (W, W))).decode()

def run(text):
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'

def control(i, content, gallery=False):
    kind = '<w:docPartObj><w:docPartGallery w:val="Page Numbers (Bottom of Page)"/><w:docPartUnique/></w:docPartObj>' if gallery else '<w:richText/>'
    return f'<w:sdt><w:sdtPr><w:rPr><w:color w:val="FF0000"/></w:rPr><w:alias w:val="Retained story control {i}"/><w:id w:val="{i}"/><w:lock w:val="sdtContentLocked"/>{kind}</w:sdtPr><w:sdtEndPr><w:rPr><w:i/></w:rPr></w:sdtEndPr><w:sdtContent>{content}</w:sdtContent></w:sdt>'

def field(kind):
    return '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + kind + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + run('99') + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'

def paragraph(content, extra=''):
    return f'<w:p><w:pPr>{extra}<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/></w:pPr>{content}</w:p>'

header = control(101, control(102, paragraph(run('Retained header'))), True)
footer = control(201, paragraph(picture + run('Page ') + control(202, field('PAGE')) + run(' of ') + control(203, field('NUMPAGES'))), True)
for kind, content in [('header', header), ('footer', footer)]:
    tag = 'hdr' if kind == 'header' else 'ftr'
    parts[f'word/{kind}.xml'] = f'<w:{tag} xmlns:w="{W}" xmlns:r="{R}">{content}</w:{tag}>'.encode()
parts['word/_rels/footer.xml.rels'] = f'<Relationships xmlns="{REL}"><Relationship Id="square" Type="{R}/image" Target="media/square.png"/></Relationships>'.encode()
section = '<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="7200" w:h="8640"/><w:pgMar w:top="720" w:right="720" w:bottom="1440" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
body = paragraph(run('First body page.')) + paragraph(run('Second body page.'), '<w:pageBreakBefore/>') + section
parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}</w:body></w:document>'.encode()
parts['word/_rels/document.xml.rels'] = ('<Relationships xmlns="' + REL + '">' + ''.join(f'<Relationship Id="{kind}" Type="{R}/{kind}" Target="{kind}.xml"/>' for kind in ['styles', 'settings', 'header', 'footer']) + '</Relationships>').encode()
parts['[Content_Types].xml'] = ('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' + ''.join(f'<Override PartName="/word/{part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>' for part, kind in [('document', 'document.main'), ('styles', 'styles'), ('settings', 'settings'), ('header', 'header'), ('footer', 'footer')]) + '</Types>').encode()
with ZipFile(root / 'public/fixtures/retained-story-controls.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
