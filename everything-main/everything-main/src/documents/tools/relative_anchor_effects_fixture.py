"""Original axis-specific relative-anchor controls; no corpus XML or engine code."""
from pathlib import Path
from copy import deepcopy
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
S = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WP14 = 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'


def generate():
    with ZipFile(ROOT / 'public/fixtures/shape-defaults.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    old = E.fromstring(parts['word/document.xml'])
    root = E.Element(old.tag, attrib=dict(old.attrib), nsmap={**old.nsmap, 'wp14': WP14, 'mc': MC})
    root.set(f'{{{MC}}}Ignorable', (root.get(f'{{{MC}}}Ignorable', '') + ' wp14').strip())
    root.extend(old)
    root.find(f'.//{{{W}}}t').text = 'Relative anchor effect extents'
    # Keep the table's starting position independent of default font metrics.
    title = root.find(f'{{{W}}}body/{{{W}}}p')
    paragraph_properties = E.Element(f'{{{W}}}pPr')
    E.SubElement(paragraph_properties, f'{{{W}}}spacing', {f'{{{W}}}line': '360', f'{{{W}}}lineRule': 'exact', f'{{{W}}}before': '0', f'{{{W}}}after': '120'})
    title.insert(0, paragraph_properties)
    run_properties = E.Element(f'{{{W}}}rPr')
    E.SubElement(run_properties, f'{{{W}}}rFonts', {f'{{{W}}}ascii': 'Arial', f'{{{W}}}hAnsi': 'Arial'})
    E.SubElement(run_properties, f'{{{W}}}sz', {f'{{{W}}}val': '24'})
    title.find(f'{{{W}}}r').insert(0, run_properties)
    for i, anchor in enumerate(root.iter(f'{{{WP}}}anchor')):
        mode = ['', 'H', 'V', 'HV'][i // 2]
        # The second column uses a margin offset; both columns resolve to the
        # same page grid as the original fixture (36 pt page margins).
        if i % 2:
            position = anchor.find(f'{{{WP}}}positionH')
            position.set('relativeFrom', 'margin')
            position.find(f'{{{WP}}}posOffset').text = str(284 * 12700)
        effects = E.Element(f'{{{WP}}}effectExtent', **{side: str(pt * 12700) for side, pt in [('l', 5), ('t', 7), ('r', 11), ('b', 13)]})
        anchor.insert(list(anchor).index(anchor.find(f'{{{WP}}}extent')) + 1, effects)
        for axis in mode:
            size = E.SubElement(anchor, f'{{{WP14}}}sizeRel{axis}', relativeFrom='page')
            E.SubElement(size, f'{{{WP14}}}pct' + ('Width' if axis == 'H' else 'Height')).text = '30000' if axis == 'H' else '10000'
        shape = anchor.find(f'.//{{{S}}}wsp')
        text = shape.find(f'{{{S}}}txbx')
        if text is not None:
            shape.remove(text)
        props = shape.find(f'{{{S}}}spPr')
        for node in list(props):
            if E.QName(node).localname not in ['xfrm', 'prstGeom']:
                props.remove(node)
        props.find(f'{{{A}}}prstGeom').set('prst', 'ellipse' if i % 2 else 'rect')
        E.SubElement(props, f'{{{A}}}noFill')
        line = E.SubElement(props, f'{{{A}}}ln', w='38100', algn='ctr')
        E.SubElement(E.SubElement(line, f'{{{A}}}solidFill'), f'{{{A}}}srgbClr', val='DC2040')
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    directory = ROOT / 'tests/fixtures/relative-anchor-effects'
    directory.mkdir(parents=True, exist_ok=True)
    with ZipFile(directory / 'source.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    # Repeat the same authored objects in one cell to distinguish page-based
    # cell positioning from ordinary body positioning.
    cell_root = deepcopy(root)
    body = cell_root.find(f'{{{W}}}body')
    paragraphs = list(body.findall(f'{{{W}}}p'))[1:]
    table = E.Element(f'{{{W}}}tbl')
    pr = E.SubElement(table, f'{{{W}}}tblPr')
    E.SubElement(pr, f'{{{W}}}tblW', {f'{{{W}}}w': '10000', f'{{{W}}}type': 'dxa'})
    margins = E.SubElement(pr, f'{{{W}}}tblCellMar')
    for side in ['top', 'left', 'bottom', 'right']:
        E.SubElement(margins, f'{{{W}}}{side}', {f'{{{W}}}w': '0', f'{{{W}}}type': 'dxa'})
    E.SubElement(E.SubElement(table, f'{{{W}}}tblGrid'), f'{{{W}}}gridCol', {f'{{{W}}}w': '10000'})
    cell = E.SubElement(E.SubElement(table, f'{{{W}}}tr'), f'{{{W}}}tc')
    E.SubElement(E.SubElement(cell, f'{{{W}}}tcPr'), f'{{{W}}}tcW', {f'{{{W}}}w': '10000', f'{{{W}}}type': 'dxa'})
    for paragraph in paragraphs:
        body.remove(paragraph)
        cell.append(paragraph)
    body.insert(1, table)
    parts['word/document.xml'] = E.tostring(cell_root, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(directory / 'cell.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)


if __name__ == '__main__':
    generate()
