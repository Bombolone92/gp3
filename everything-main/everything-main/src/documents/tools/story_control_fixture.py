"""Original header/footer SDT probes based on our original page-story fixture."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
with ZipFile(ROOT/'tests/fixtures/page-stories/footer-variants.docx') as z:
    source = {n:z.read(n).decode() for n in z.namelist()}

def control(content, identity, gallery=False):
    kind = '<w:docPartObj><w:docPartGallery w:val="Page Numbers (Bottom of Page)"/><w:docPartUnique/></w:docPartObj>' if gallery else '<w:richText/>'
    return f'<w:sdt><w:sdtPr><w:id w:val="{identity}"/><w:lock w:val="sdtContentLocked"/>{kind}</w:sdtPr><w:sdtContent>{content}</w:sdtContent></w:sdt>'

for wrapped in [False, True]:
    parts = dict(source)
    for i, variant in enumerate(['first','even','default']):
        footer = source[f'word/footer-{variant}.xml']
        header = footer.replace('w:ftr','w:hdr').replace(f'{variant.title()} ',f'Header {variant.title()} ')
        for kind, text in [('footer',footer),('header',header)]:
            if wrapped:
                # A nested block control contains an inline control around the
                # complete PAGE field, whose stale saved result is still 99.
                start = text.index('<w:r><w:fldChar')
                end = text.rindex('</w:p>')
                text = text[:start] + control(text[start:end],100+i*10+(kind=='header')) + text[end:]
                text = re.sub(r'(<w:(?:ftr|hdr)[^>]*>)(.*)(</w:(?:ftr|hdr)>)', lambda m:m[1]+control(control(m[2],200+i*10+(kind=='header')),300+i*10+(kind=='header'),True)+m[3],text)
            parts[f'word/{kind}-{variant}.xml'] = text
        parts['word/document.xml'] = parts['word/document.xml'].replace('<w:sectPr>',f'<w:sectPr><w:headerReference w:type="{variant}" r:id="header-{variant}"/>')
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="header-{variant}" Type="{R}/header" Target="header-{variant}.xml"/></Relationships>')
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/header-{variant}.xml" ContentType="{CT}header+xml"/></Types>')
    path = ROOT/f'public/fixtures/story-controls-{"wrapped" if wrapped else "plain"}.docx'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        for name,data in parts.items():z.writestr(name,data)
    print(path)
