"""Fetch the published MS-ODRAWXML schemas into temporary test caches only.

The supported WPG/WPS subset excludes w14 contentPart and legacy wne text boxes.
Remove only those alternatives/imports (narrowing, not widening, the schemas),
then resolve the MS-ODRAWXML split standard imports to the official ECMA schemas.
"""
from pathlib import Path
import hashlib
import tempfile
import urllib.request
from lxml import etree

WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
ADEC = 'http://schemas.microsoft.com/office/drawing/2017/decorative'
A16 = 'http://schemas.microsoft.com/office/drawing/2014/main'
ASVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main'
DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram'
WP14 = 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing'
SCHEMAS = {
    'wp14': ('1a38a99a-16ae-420d-8c79-23dc2e922717', 'ca12eeff32cd1640a7bdcf2c1b7c29fcb2ff2674cd66a4f0fc10ec02eaf62ad6'),
    'dsp': ('e1b56dd5-305b-4b3b-a983-28df1d4ffc3f', '68563c6160681b70073222bcd18dfd7b641d308e427f28f6840d2f4ad8229b6b'),
    'asvg': ('cc083f6d-bc38-4ff4-b32a-5bc97df8addc', '223bc75cf99d3520f1673c6a673513cea06588fdf0020c91f605b78bb53e5ff9'),
    'wps': ('f73ea06d-4749-4611-b20b-755df087eb21', 'caa6cc8cc744a44337cfa0b41a3d9b5a694ce074573649e7ad6820ea7535c45e'),
    'wpg': ('fbe733bf-85e2-46f9-b548-9292b44670ce', 'b2e52fc06210f53e84067a3d1eae143079d63707ddf8a67bdd77bc0579394c7c'),
    'adec': ('6146d89f-9146-415b-99e2-39e694b5a980', '37d90feb72422cb95f12cabe6d5c4423af947c81a546f8ac0025e28932e9b712'),
    'a16': ('55a2958e-599f-46a0-8812-029155d485cb', '2f38c5a44cf9e886126ffbe5055974e6d19f8edfcffacc7bc5a41177f955a39d'),
}

def install(directory):
    locations = {
        'http://schemas.openxmlformats.org/drawingml/2006/diagram': 'dml-diagram.xsd',
        'http://schemas.openxmlformats.org/drawingml/2006/main': 'dml-main.xsd',
        'http://schemas.openxmlformats.org/drawingml/2006/picture': 'dml-picture.xsd',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'shared-relationshipReference.xsd',
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'wml.xsd',
        WPS: 'wps.xsd',
    }
    excluded = {'http://schemas.microsoft.com/office/word/2006/wordml', 'http://schemas.microsoft.com/office/word/2010/wordml'}
    for name, (identifier, digest) in SCHEMAS.items():
        path = Path(tempfile.gettempdir()) / f'documents-ms-{name}.xsd'
        if not path.exists():
            url = 'https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/' + identifier
            with urllib.request.urlopen(url, timeout=30) as response: html = etree.HTML(response.read())
            text = next(''.join(p.itertext()) for p in html.xpath('//pre') if '<xsd:schema' in ''.join(p.itertext()))
            path.write_bytes(text.replace('\xa0', ' ').strip().encode())
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest: raise RuntimeError(f'{name} schema hash mismatch; review the published schema before updating the pin')
        # The MS-ODRAWXML split oartbasetypes exposes ST_Guid under DrawingML;
        # ECMA's combined schema exposes the same definition in sharedTypes.
        # Resolve that one type to the original ECMA definition, unmodified.
        if name == 'a16':
            shared = 'http://schemas.openxmlformats.org/officeDocument/2006/sharedTypes'
            data = data.replace(b'<xsd:schema ', f'<xsd:schema xmlns:s="{shared}" '.encode()).replace(b'type="a:ST_Guid"', b'type="s:ST_Guid"')
            locations[shared] = 'shared-commonSimpleTypes.xsd'
        schema = etree.fromstring(data)
        if name == 'a16':
            schema.insert(0, etree.Element('{http://www.w3.org/2001/XMLSchema}import', namespace=shared))
        for node in list(schema.iter()):
            if node.tag == '{http://www.w3.org/2001/XMLSchema}import':
                ns = node.get('namespace')
                if ns in excluded: node.getparent().remove(node)
                else: node.set('schemaLocation', locations[ns])
            elif node.get('ref', '').split(':')[0] in {'wne', 'w14'}: node.getparent().remove(node)
        Path(directory, name + '.xsd').write_bytes(etree.tostring(schema))
    # MS-ODRAWXML 2.19.1.1/2 defines these as children of the corresponding
    # standard position elements. Extend just those choices in the temporary
    # validation schema; keep the published percentage types unchanged.
    path = Path(directory, 'dml-wordprocessingDrawing.xsd')
    original = etree.parse(str(path)).getroot()
    extended = etree.Element(original.tag, nsmap={**original.nsmap, 'wp14': WP14})
    extended.attrib.update(original.attrib)
    extended.extend(list(original))
    xs = 'http://www.w3.org/2001/XMLSchema'
    extended.insert(0, etree.Element(f'{{{xs}}}import', namespace=WP14, schemaLocation='wp14.xsd'))
    for axis in ('H', 'V'):
        choices = extended.xpath(f'xs:complexType[@name="CT_Pos{axis}"]/xs:sequence/xs:choice', namespaces={'xs': xs})
        if len(choices) != 1: raise RuntimeError(f'Unexpected standard CT_Pos{axis} schema')
        etree.SubElement(choices[0], f'{{{xs}}}element', ref=f'wp14:pctPos{axis}Offset')
    path.write_bytes(etree.tostring(extended))
    return f'<xs:import namespace="{WP14}" schemaLocation="wp14.xsd"/><xs:import namespace="{DSP}" schemaLocation="dsp.xsd"/><xs:import namespace="{WPS}" schemaLocation="wps.xsd"/><xs:import namespace="{WPG}" schemaLocation="wpg.xsd"/><xs:import namespace="{ADEC}" schemaLocation="adec.xsd"/><xs:import namespace="{A16}" schemaLocation="a16.xsd"/><xs:import namespace="{ASVG}" schemaLocation="asvg.xsd"/>'
