"""Validate appearance and binding metadata using published MS-DOCX declarations.

Keep the downloaded standard in a temporary cache. Extract the three original
appearance declarations unchanged and import the standard binding type;
unrelated extension types are not supported.
The containing document is checked separately after standard MCE processing.
"""
from pathlib import Path
import hashlib
import tempfile
import urllib.request
from lxml import etree

W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
URL = 'https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/d416013d-c112-44fa-8bef-7819b8898117'
SHA256 = '67156f19c621572081cfc8427c588c84afeb69acaf4ca58445520d1b2fdc2886'

def schema_root():
    path = Path(tempfile.gettempdir()) / 'documents-ms-w15.xsd'
    if not path.exists():
        with urllib.request.urlopen(URL, timeout=30) as response: html = etree.HTML(response.read())
        text = next(''.join(p.itertext()) for p in html.xpath('//pre') if '<xsd:schema' in ''.join(p.itertext()))
        path.write_bytes(text.replace('\xa0', ' ').strip().encode())
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != SHA256: raise RuntimeError('MS-DOCX schema hash mismatch; review before changing the pin')
    return etree.fromstring(data)

def install_binding_schema(directory):
    root = schema_root()
    for node in list(root):
        if node.tag == '{http://www.w3.org/2001/XMLSchema}import':
            # The published declaration imports a vendor CT_DataBinding; use the
            # equivalent ECMA transitional schema already loaded by the checker.
            node.set('schemaLocation', 'wml.xsd')
        elif node.get('name') != 'dataBinding':
            root.remove(node)
    Path(directory, 'w15-binding.xsd').write_bytes(etree.tostring(root))
    return f'<xs:import namespace="{W15}" schemaLocation="w15-binding.xsd"/>'

def appearance_schema():
    root = schema_root()
    for node in list(root):
        if node.get('name') not in {'appearance', 'CT_SdtAppearance', 'ST_SdtAppearance'}: root.remove(node)
    validator = etree.XMLSchema(root)
    if validator.validate(etree.fromstring(f'<w15:appearance xmlns:w15="{W15}" w15:val="invalid"/>'.encode())):
        raise RuntimeError('Appearance schema self-check accepted an invalid enumeration')
    if not validator.validate(etree.fromstring(f'<w15:appearance xmlns:w15="{W15}" w15:val="hidden"/>'.encode())):
        raise RuntimeError('Appearance schema self-check rejected hidden controls')
    return validator
