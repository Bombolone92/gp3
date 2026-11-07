"""Original DrawingML homePlate/chevron controls; no corpus artwork."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
# Defaults, inward clamp, outward clamp, and the chevron text-rectangle branch
# on each side of half-width, followed by portrait and transformed controls.
cases = [(None, 200, 90), (-5000, 200, 90), (300000, 200, 90),
         (100000, 200, 90), (120000, 200, 90), (None, 90, 100),
         (25000, 90, 100), (25000, 200, 90)]
for kind in ['homePlate', 'chevron']:
    with ZipFile(root/'public/fixtures/shape-defaults.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    doc = E.fromstring(parts['word/document.xml'])
    shapes = doc.findall('.//wps:wsp', ns)
    text = deepcopy(shapes[4].find('wps:txbx', ns))
    for i, (shape, (adjustment, width, height)) in enumerate(zip(shapes, cases)):
        props = shape.find('wps:spPr', ns)
        geom = props.find('a:prstGeom', ns)
        geom.set('prst', kind)
        values = geom.find('a:avLst', ns)
        values.clear()
        if adjustment is not None:
            E.SubElement(values, '{'+ns['a']+'}gd', name='adj', fmla=f'val {adjustment}')
        transform = props.find('a:xfrm', ns)
        extent = transform.find('a:ext', ns)
        extent.set('cx', str(width*12700)); extent.set('cy', str(height*12700))
        anchor = next(p for p in shape.iterancestors() if p.tag == '{'+ns['wp']+'}anchor')
        extent = anchor.find('wp:extent', ns)
        extent.set('cx', str(width*12700)); extent.set('cy', str(height*12700))
        if i == 7:
            transform.set('flipH', '1'); transform.set('flipV', '1'); transform.set('rot', '1800000')
        for name in ['solidFill', 'ln', 'effectLst', 'sp3d']:
            for node in props.findall('a:'+name, ns): props.remove(node)
        fill = E.SubElement(props, '{'+ns['a']+'}solidFill')
        E.SubElement(fill, '{'+ns['a']+'}srgbClr', val='228844')
        E.SubElement(E.SubElement(props, '{'+ns['a']+'}ln'), '{'+ns['a']+'}noFill')
        old = shape.find('wps:txbx', ns)
        if old is not None: shape.remove(old)
        if i in [0, 3, 4, 5, 6]:
            prompt = deepcopy(text)
            for t in prompt.findall('.//w:t', ns): t.text = 'Text'
            for pr in prompt.findall('.//w:pPr', ns):
                E.SubElement(pr, '{'+ns['w']+'}jc', {'{'+ns['w']+'}val': 'center'})
            for rp in prompt.findall('.//w:rPr', ns):
                fonts = E.SubElement(rp, '{'+ns['w']+'}rFonts')
                for key in ['ascii', 'hAnsi', 'cs', 'eastAsia']: fonts.set('{'+ns['w']+'}'+key, 'Arial')
            shape.insert(list(shape).index(shape.find('wps:bodyPr', ns)), prompt)
    parts['word/document.xml'] = E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(root/f'public/fixtures/arrow-{kind}.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)
