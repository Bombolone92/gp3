"""Validate the unchanged published MS-ODRAWXML shadow-obscuration declarations."""
from pathlib import Path
import hashlib, tempfile, urllib.request
from lxml import etree

A14 = 'http://schemas.microsoft.com/office/drawing/2010/main'
URL = 'https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/869af0ef-665b-4f28-a596-0917474ede26'
SHA256 = '580971e4080c8d06d71123d8fe454cfaf9c6f06f58d0c63ab4298c54d8aca348'

def published_schema():
    path = Path(tempfile.gettempdir()) / 'documents-ms-a14.xsd'
    if not path.exists():
        with urllib.request.urlopen(URL, timeout=30) as response: html = etree.HTML(response.read())
        text = next(''.join(p.itertext()) for p in html.xpath('//pre') if '<xsd:schema' in ''.join(p.itertext()))
        path.write_bytes(text.replace('\xa0', ' ').strip().encode())
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != SHA256: raise RuntimeError('MS-ODRAWXML a14 schema hash mismatch; review before changing the pin')
    return etree.fromstring(data)


def install_hidden_line(directory):
    root = published_schema()
    for node in list(root):
        if node.get('name') not in {'hiddenLine', 'hiddenFill'}: root.remove(node)
    root.insert(0, etree.Element('{http://www.w3.org/2001/XMLSchema}import', namespace='http://schemas.openxmlformats.org/drawingml/2006/main', schemaLocation='dml-main.xsd'))
    Path(directory, 'hidden-line.xsd').write_bytes(etree.tostring(root))
    return f'<xs:import namespace="{A14}" schemaLocation="hidden-line.xsd"/>'


def shadow_schema():
    root = published_schema()
    for node in list(root):
        if node.get('name') not in {'shadowObscured', 'CT_ShadowObscured'}: root.remove(node)
    validator = etree.XMLSchema(root)
    for attrs, valid in [('', True), ('val="true"', True), ('val="0"', True), ('val="yes"', False), ('future="1"', False)]:
        if validator.validate(etree.fromstring(f'<a14:shadowObscured xmlns:a14="{A14}" {attrs}/>'.encode())) != valid:
            raise RuntimeError('Shadow obscuration schema self-check failed')
    return validator
