"""Independent OOXML controls for empty paragraphs and inline picture transitions."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import hashlib, json, struct, zlib

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
N = '{' + W + '}'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def generate(destination):
    destination.mkdir(parents=True, exist_ok=True)
    with ZipFile(ROOT / 'tests/fixtures/auto-line-spacing-rounding/control.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    xml = E.fromstring(parts['word/document.xml'])
    body = xml.find(N + 'body'); sect = body.find(N + 'sectPr')
    body.remove(sect); body.clear()
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    parts['word/media/metric-control.png'] = (b'\x89PNG\r\n\x1a\n' +
        chunk(b'IHDR', struct.pack('>2I5B', 1, 1, 8, 2, 0, 0, 0)) +
        chunk(b'IDAT', zlib.compress(b'\x00\x30\x80\xc0')) + chunk(b'IEND', b''))
    rel = E.fromstring(parts['word/_rels/document.xml.rels'])
    E.SubElement(rel, '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',
        Id='rIdMetricPicture', Type=R + '/image', Target='media/metric-control.png')
    parts['word/_rels/document.xml.rels'] = E.tostring(rel, xml_declaration=True, encoding='UTF-8')
    ct = E.fromstring(parts['[Content_Types].xml'])
    if not any(e.get('Extension') == 'png' for e in ct):
        E.SubElement(ct, '{http://schemas.openxmlformats.org/package/2006/content-types}Default',
            Extension='png', ContentType='image/png')
    parts['[Content_Types].xml'] = E.tostring(ct, xml_declaration=True, encoding='UTF-8')
    cases = []
    def props(parent, family, size):
        E.SubElement(parent, N+'rFonts', {N+'ascii':family, N+'hAnsi':family})
        E.SubElement(parent, N+'sz', {N+'val':str(size*2)})
    def paragraph(family, size, multiple, page_break=False):
        p = E.SubElement(body, N+'p'); pr = E.SubElement(p, N+'pPr')
        if page_break: E.SubElement(pr, N+'pageBreakBefore')
        E.SubElement(pr, N+'spacing', {N+'before':'0', N+'after':'0', N+'line':str(multiple), N+'lineRule':'auto'})
        props(E.SubElement(pr,N+'rPr'),family,size)
        return p
    def text(p, family, size, value):
        run=E.SubElement(p,N+'r'); props(E.SubElement(run,N+'rPr'),family,size)
        E.SubElement(run,N+'t').text=value
        return run
    for family in ['Arial', 'Trebuchet MS', 'Times New Roman', 'Garamond']:
        for size in [11, 28]:
            for multiple in [240, 259, 276]:
                for transition in ['empty-small', 'empty-large', 'picture', 'picture-text']:
                    page=len(cases)
                    text(paragraph(family,size,multiple,page>0),family,size,'Aa 00')
                    gap_size = 6 if transition=='empty-small' else 24 if transition=='empty-large' else size
                    gap=paragraph(family,gap_size,multiple)
                    if transition.startswith('picture'):
                        run=E.SubElement(gap,N+'r'); props(E.SubElement(run,N+'rPr'),family,size)
                        run.append(E.fromstring(f'''<w:drawing xmlns:w="{W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="{R}"><wp:inline><wp:extent cx="304800" cy="304800"/><wp:docPr id="{page+1}" name="Original metric square"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="metric-control.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdMetricPicture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="304800" cy="304800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'''))
                        if transition=='picture-text':text(gap,family,size,'Aa 01')
                    last=paragraph(family,size,multiple)
                    run=text(last,family,size,'Aa 02'); E.SubElement(run,N+'br'); E.SubElement(run,N+'t').text='Aa 03'
                    cases.append(dict(page=page,family=family,size=size,multiple=multiple,transition=transition,gapSize=gap_size,
                        labels=['Aa 00']+(['Aa 01'] if transition=='picture-text' else [])+['Aa 02','Aa 03']))
    body.append(sect)
    parts['word/document.xml']=E.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
    with ZipFile(destination/'control.docx','w',ZIP_DEFLATED) as z:
        for name,data in parts.items():
            entry=ZipInfo(name,(2020,1,1,0,0,0));entry.compress_type=ZIP_DEFLATED;z.writestr(entry,data)
    (destination/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
    print(hashlib.sha256((destination/'control.docx').read_bytes()).hexdigest())


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination',type=Path)
    generate(parser.parse_args().destination)
