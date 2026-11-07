"""Original OOXML controls: manual breaks preserve picture text exclusions."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
from top_bottom_flow_fixture import make, drawing, paragraph, W, WP, A, PIC, R

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/manual-break-wrapping'
NS = f'xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}" xmlns:r="{R}"'
CASES = [
    dict(name='band-before', top=0), dict(name='band-between', top=20),
    dict(name='band-after', top=30), dict(name='anchor-after-break', top=20, after=True),
    dict(name='square-right', top=0, square=True, x=0),
    dict(name='square-both', top=0, square=True, x=180),
    dict(name='consecutive-breaks', top=20, breaks=2),
    dict(name='terminal-break', top=20, terminal=True),
    dict(name='large-break-run', top=20, break_size=48),
    dict(name='square-explicit-none', top=0, square=True, x=180, clear_none=True),
    dict(name='square-carriage-return', top=0, square=True, x=180, cr=True),
    dict(name='square-consecutive-breaks', top=0, square=True, x=180, breaks=2),
    dict(name='square-terminal-break', top=0, square=True, x=180, terminal=True),
]

def run(text='', size=24, contents=None):
    return f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="{size}"/></w:rPr>' + (contents if contents is not None else f'<w:t>{text}</w:t>') + '</w:r>'

def case(index, options):
    image = drawing(index + 1, options['top'], 12 if not options.get('square') else 40)
    if options.get('square'):
        image = image.replace('<wp:wrapTopAndBottom/>', '<wp:wrapSquare wrapText="bothSides"/>').replace('<wp:posOffset>0</wp:posOffset></wp:positionH>', f'<wp:posOffset>{options["x"] * 12700}</wp:posOffset></wp:positionH>')
    first, second = run(f'FIRST {index}'), run(f'SECOND {index}')
    tag = '<w:cr/>' if options.get('cr') else '<w:br w:clear="none"/>' if options.get('clear_none') else '<w:br/>'
    br = run(size=options.get('break_size', 24), contents=tag * options.get('breaks', 1))
    content = first + br + image + second if options.get('after') else image + first + br + ('' if options.get('terminal') else second)
    return paragraph(drawings=content) + paragraph(f'FOLLOW {index}', before=40)

def write(path, parts):
    with ZipFile(path, 'w') as archive:
        for name, data in parts.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)

def build():
    OUT.mkdir(parents=True, exist_ok=True)
    section = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:left="1440" w:right="1440" w:bottom="1440" w:header="360" w:footer="360" w:gutter="0"/>'
    parts = make(15)
    body = ''.join(paragraph(f'CASE {i}', page_break=i > 0) + case(i, c) for i, c in enumerate(CASES))
    parts['word/document.xml'] = f'<w:document {NS}><w:body>{body}<w:sectPr>{section}</w:sectPr></w:body></w:document>'
    write(OUT / 'body.docx', parts)
    for story in ['header', 'footer']:
        parts = make(15)
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', f'<Override PartName="/word/{story}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{story}+xml"/></Types>')
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="story" Type="{R}/{story}" Target="{story}.xml"/></Relationships>')
        parts[f'word/_rels/{story}.xml.rels'] = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="picture" Type="{R}/image" Target="media/panel.png"/></Relationships>'
        tag = 'hdr' if story == 'header' else 'ftr'
        parts[f'word/{story}.xml'] = f'<w:{tag} {NS}>' + ''.join(paragraph(f'CASE {i}') + case(i, c) for i, c in enumerate(CASES[:3])) + f'</w:{tag}>'
        parts['word/document.xml'] = f'<w:document {NS}><w:body>{paragraph("BODY")}<w:sectPr><w:{story}Reference w:type="default" r:id="story"/>{section}</w:sectPr></w:body></w:document>'
        write(OUT / f'{story}.docx', parts)
    (OUT / 'cases.json').write_text(json.dumps(CASES, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    build()
