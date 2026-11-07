"""Original OOXML control for list-level paragraph properties, picture nvPr and unopenable link targets.

Uses only Python's standard library; no desktop application or document engine is required.
ZIP timestamps are fixed so the output is reproducible.
"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import struct
import zlib

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/list-borders-retained-links'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

LINKS = {
    'relative': '../Shared Documents/Plan v2.docx',
    'file': 'file:///C:\\Reports\\Q3 summary.docx',
    'web': 'https://example.com/report',
    'drawing': 'Appendix A.docx',
}


def png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    pixels = zlib.compress((b'\0' + bytes([40, 90, 200]) * 8) * 8)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 8, 8, 8, 2, 0, 0, 0)) + chunk(b'IDAT', pixels) + chunk(b'IEND', b'')


def run(text):
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def p(content, props=''):
    return f'<w:p>{"<w:pPr>" + props + "</w:pPr>" if props else ""}{content}</w:p>'


def item(text, num, level, extra=''):
    return p(run(text), f'<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num}"/></w:numPr>{extra}')


# The non-visual nvPr after cNvPicPr is outside CT_PictureNonVisual; producers emit it anyway.
PICTURE = f'''<w:r><w:drawing><wp:inline><wp:extent cx="457200" cy="457200"/><wp:docPr id="1" name="Picture 1"><a:hlinkClick r:id="drawingLink"/></wp:docPr><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture 1"/><pic:cNvPicPr/><pic:nvPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'''


def level(index, borders, left, before='', spacing='', after=''):
    """`before`, `spacing` and `after` are pPr content around pBdr and ind, in CT_PPrBase order."""
    return f'<w:lvl w:ilvl="{index}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%{index + 1}."/><w:lvlJc w:val="left"/><w:pPr>{before}<w:pBdr>{borders}</w:pBdr>{spacing}<w:ind w:left="{left}" w:hanging="360"/>{after}</w:pPr></w:lvl>'


def main():
    body = p(run('List level borders'))
    body += item('Bordered item one', 1, 0)
    body += item('Nested bordered item', 1, 1)
    body += item('Direct border override', 1, 0, '<w:pBdr><w:bottom w:val="nil"/></w:pBdr><w:spacing w:after="0"/>')
    body += p(run('Style list item'), '<w:pStyle w:val="BorderedList"/>')
    body += p(PICTURE)
    for key in ['relative', 'file', 'web']:
        body += p(run('Link: ') + f'<w:hyperlink r:id="{key}">{run(key + " destination")}</w:hyperlink>')
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    numbering = (
        f'<w:numbering xmlns:w="{W}">'
        '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>'
        + level(0, '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="2F5496"/>', 720, spacing='<w:spacing w:before="120" w:after="60" w:line="360" w:lineRule="auto"/>')
        + level(1, '<w:left w:val="double" w:sz="12" w:space="4" w:color="C00000"/>', 1440, after='<w:jc w:val="center"/>')
        + '</w:abstractNum>'
        '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>'
        + level(0, '<w:left w:val="single" w:sz="8" w:space="4" w:color="00B050"/><w:bottom w:val="dotted" w:sz="4" w:space="1" w:color="00B050"/>', 720, before='<w:keepNext/>', spacing='<w:spacing w:before="240" w:after="240"/>')
        + '</w:abstractNum>'
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>'
    )
    styles = (
        f'<w:styles xmlns:w="{W}">'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="BorderedList"><w:name w:val="Bordered List"/><w:basedOn w:val="Normal"/>'
        '<w:pPr><w:numPr><w:numId w:val="2"/></w:numPr><w:pBdr><w:left w:val="single" w:sz="4" w:space="4" w:color="000000"/></w:pBdr><w:spacing w:before="0"/></w:pPr></w:style>'
        '</w:styles>'
    )
    rels = [f'<Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/>', f'<Relationship Id="numbering" Type="{R}/numbering" Target="numbering.xml"/>', f'<Relationship Id="image1" Type="{R}/image" Target="media/image1.png"/>']
    rels += [f'<Relationship Id="{key if key != "drawing" else "drawingLink"}" Type="{R}/hyperlink" Target="{target}" TargetMode="External"/>' for key, target in LINKS.items()]
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>'
        + ''.join(f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>' for name, kind in [('document', 'document.main'), ('styles', 'styles'), ('numbering', 'numbering')]) + '</Types>',
        '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:pic="{PIC}"><w:body>{body}</w:body></w:document>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}">{"".join(rels)}</Relationships>',
        'word/styles.xml': styles,
        'word/numbering.xml': numbering,
        'word/media/image1.png': png(),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUT / 'combined.docx', 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)


if __name__ == '__main__':
    main()
