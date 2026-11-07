"""Original controls for drawings outside multi-column sections."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/mixed-section-drawings'
OUT.mkdir(exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'

def section(columns=1):
    return f'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:num="{columns}" w:space="720"/></w:sectPr>'

def drawing(identifier, color):
    return f'''<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="{identifier}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">
<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>1828800</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="457200"/><wp:wrapNone/><wp:docPr id="{identifier}" name="Original rectangle {identifier}"/>
<a:graphic><a:graphicData uri="{WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>
</wp:anchor></w:drawing></w:r>'''

def paragraph(text, extra='', end=''):
    return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>{end}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr><w:t>{text}</w:t></w:r>{extra}</w:p>'

body = paragraph('Before columns', drawing(1, 'D02030'), section())
body += paragraph('Left column', '<w:r><w:br w:type="column"/></w:r>')
body += paragraph('Right column', end=section(2))
body += paragraph('After columns', drawing(2, '2050D0')) + section()
with ZipFile(ROOT/'public/fixtures/empty-table-fragment.docx') as archive:
    parts = {name: archive.read(name) for name in archive.namelist()}
parts['word/document.xml'] = f'<w:document xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:wps="{WPS}"><w:body>{body}</w:body></w:document>'
with ZipFile(OUT/'control.docx', 'w', ZIP_DEFLATED) as archive:
    for name, data in parts.items():
        archive.writestr(name, data)
