"""Original one-table VDMX experiment; no production rendering rule is implied.

Derived from the repository's OFL Bebas Neue and its corresponding design
source. Glyphs, hinting and advances are unchanged. Deliberately enlarged
device bounds distinguish table effects from OS/2/hhea metric effects.
"""
import hashlib
import json
import math
import struct
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from script_position_metrics_fixture import build, checksum

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'tests/fixtures/script-vdmx-position'


def tables(data):
    result = {}
    for i in range(struct.unpack_from('>H', data, 4)[0]):
        tag, _, offset, length = struct.unpack_from('>4sIII', data, 12 + i * 16)
        result[tag] = data[offset:offset + length]
    return result


def with_vdmx(data, ascent, descent):
    t = tables(data)
    # Version 1, one group, one ratio; all-ratios default, full character set.
    entries = b''.join(struct.pack('>Hhh', ppem, math.ceil(ascent * ppem),
                                   -math.ceil(descent * ppem))
                       for ppem in range(1, 256))
    t[b'VDMX'] = struct.pack('>3H4BH', 1, 1, 1, 1, 0, 0, 0, 12) + struct.pack('>HBB', 255, 1, 255) + entries
    head = bytearray(t[b'head']); struct.pack_into('>I', head, 8, 0); t[b'head'] = head
    count = len(t); power = 2 ** (count.bit_length() - 1)
    result = bytearray(struct.pack('>I4H', 0x10000, count, power * 16,
                                   power.bit_length() - 1, count * 16 - power * 16))
    directory, payload = bytearray(), bytearray()
    offset, head_offset = 12 + count * 16, None
    for tag, value in sorted(t.items()):
        directory.extend(struct.pack('>4sIII', tag, checksum(value), offset, len(value)))
        if tag == b'head': head_offset = offset
        padded = value + b'\0' * (-len(value) % 4)
        payload.extend(padded); offset += len(padded)
    result.extend(directory); result.extend(payload)
    struct.pack_into('>I', result, head_offset + 8, (0xb1b0afba - checksum(result)) & 0xffffffff)
    return result


def main():
    TARGET.mkdir(exist_ok=True)
    cases, paragraphs, hashes = [], [], {}
    for variant, bounds in [('Absent', None), ('Linear', (.95, .35)),
                            ('Tall', (1.35, .35)), ('Deep', (.95, .75))]:
        family = 'Script VDMX ' + variant
        path = build(family, {'OS/2': {16: 700, 24: 700}}, TARGET)
        baseline = path.read_bytes()
        if bounds:
            path.write_bytes(with_vdmx(baseline, *bounds))
        changed = tables(path.read_bytes()); original = tables(baseline)
        assert set(changed) == set(original) | ({b'VDMX'} if bounds else set())
        for tag in original:
            if tag != b'head': assert changed[tag] == original[tag], tag
            else: assert changed[tag][:8] == original[tag][:8] and changed[tag][12:] == original[tag][12:]
        assert checksum(path.read_bytes()) == 0xb1b0afba
        rows = [dict(size=size, script=script) for size in [8, 10, 11, 12, 16, 20]
                for script in ['superscript', 'subscript']]
        hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        for row_index, row in enumerate(rows):
            if row_index % 4 == 0:
                cases.append(dict(family=family, variant=variant, bounds=bounds,
                                  rows=rows[row_index:row_index+4]))
                paragraphs.append('<w:p><w:pPr>' + ('<w:pageBreakBefore/>' if len(cases)>1 else '') +
                                  '</w:pPr><w:r><w:t>' + family + '</w:t></w:r></w:p>')
            runs = []
            for text, active in [('START ', False), ('TEST', True), (' END', False)]:
                props = f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/><w:sz w:val="{row["size"]*2}"/>'
                if active: props += f'<w:vertAlign w:val="{row["script"]}"/>'
                runs.append('<w:r><w:rPr>' + props + '</w:rPr><w:t xml:space="preserve">' + text + '</w:t></w:r>')
            paragraphs.append('<w:p>' + ''.join(runs) + '</w:p>')
    document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ''.join(paragraphs) + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    parts = {name: value.encode() for name, value in
             {'[Content_Types].xml': types, '_rels/.rels': rels, 'word/document.xml': document}.items()}
    path = TARGET / 'controls.docx'
    previous = None
    if path.exists():
        with ZipFile(path) as package:
            previous = {name: package.read(name) for name in package.namelist()}
    # The reference application can hold the original input open; never rewrite an equal package.
    if previous != parts:
        with ZipFile(path, 'w', ZIP_DEFLATED) as package:
            for name, value in parts.items(): package.writestr(name, value)
    (TARGET / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
    (TARGET / 'fonts.json').write_text(json.dumps(list(hashes), indent=2) + '\n')
    license_text = (ROOT / 'tests/fixtures/script-metric-controls/OFL.txt').read_text()
    (TARGET / 'OFL.txt').write_text('\n'.join(line.rstrip() for line in license_text.splitlines()) + '\n')
    print('Generated four fonts and 48 script rows; original font tables preserved except naming, checksums and common OS/2 offsets')


if __name__ == '__main__': main()
