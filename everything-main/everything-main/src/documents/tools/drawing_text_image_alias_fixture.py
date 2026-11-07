"""Original alternate text stories whose PNG/SVG resources have alias parts."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import sys
import drawing_text_pictures_fixture as pictures


def generate(destination):
    parts = pictures.build()
    root = E.fromstring(parts['word/document.xml'])
    W = pictures.W
    MC = pictures.base.NS['mc']
    V = 'urn:schemas-microsoft-com:vml'
    drawing = root.find('.//{' + W + '}drawing')
    contents = drawing.find('.//{' + W + '}txbxContent')
    ac = E.Element('{' + MC + '}AlternateContent', nsmap={'v': V})
    choice = E.SubElement(ac, '{' + MC + '}Choice', Requires='wps')
    fallback = E.SubElement(ac, '{' + MC + '}Fallback')
    pict = E.SubElement(fallback, '{' + W + '}pict')
    shape = E.SubElement(pict, '{' + V + '}shape', id='OriginalLegacyFrame',
                         style='width:120pt;height:60pt', fillcolor='#DDEEFF', stroked='f')
    textbox = E.SubElement(shape, '{' + V + '}textbox', inset='6pt,3pt,6pt,3pt')
    legacy = E.fromstring(E.tostring(contents))
    for node in legacy.iter():
        ref = node.get('{' + pictures.R + '}embed')
        if ref:
            node.set('{' + pictures.R + '}embed', ref + 'Alias')
    textbox.append(legacy)
    drawing.getparent().replace(drawing, ac)
    choice.append(drawing)
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    relationships = E.fromstring(parts['word/_rels/document.xml.rels'])
    for extension, ident in [('png', 'rPng'), ('svg', 'rSvg')]:
        parts['word/media/alias.' + extension] = parts['word/media/square.' + extension]
        E.SubElement(relationships, '{' + relationships.nsmap[None] + '}Relationship',
                     Id=ident + 'Alias', Type=pictures.R + '/image', Target='media/alias.' + extension)
    parts['word/_rels/document.xml.rels'] = E.tostring(relationships)
    destination.mkdir(parents=True, exist_ok=True)
    controlled = dict(parts)
    controlled_root = E.fromstring(parts['word/document.xml'])
    for branch in controlled_root.find('.//{' + MC + '}AlternateContent'):
        picture = branch.find('.//{' + W + '}txbxContent').find('.//{' + W + '}drawing')
        run = picture.getparent()
        run.set('{' + W + '}rsidR', '11223344')
        wrapper = E.Element('{' + W + '}sdt')
        properties = E.SubElement(wrapper, '{' + W + '}sdtPr')
        E.SubElement(properties, '{' + W + '}id', {'{' + W + '}val': '701'})
        E.SubElement(properties, '{' + W + '}richText')
        content = E.SubElement(wrapper, '{' + W + '}sdtContent')
        run.getparent().replace(run, wrapper)
        content.append(run)
    controlled['word/document.xml'] = E.tostring(controlled_root, xml_declaration=True, encoding='UTF-8', standalone=True)
    for filename, package in [('control.docx', parts), ('header.docx', pictures.header(parts)), ('controlled.docx', controlled)]:
        with ZipFile(destination / filename, 'w') as archive:
            for name, data in package.items():
                info = ZipInfo(name, (2026, 10, 5, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                archive.writestr(info, data)
        print(destination / filename)


if __name__ == '__main__':
    generate(Path(sys.argv[1]) if len(sys.argv) > 1 else
             Path(__file__).resolve().parents[1] / 'tests/fixtures/drawing-text-image-alias')
