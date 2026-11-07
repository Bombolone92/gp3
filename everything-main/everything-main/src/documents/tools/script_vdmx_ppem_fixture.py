"""Original single-ppem VDMX controls; no native placement rule is implied."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import argparse, json, struct
from script_vdmx_fixture import with_vdmx, tables, checksum
from script_position_metrics_fixture import build

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'tests/fixtures/script-vdmx-ppem'


def perturb(data, ppem):
    """Add four device pixels to yMax at exactly one ppem; preserve all else."""
    out = bytearray(data)
    directory = {out[p:p+4].decode(): (p, *struct.unpack_from('>II', out, p+8))
                 for p in range(12, 12+16*struct.unpack_from('>H', out, 4)[0], 16)}
    entry, offset, length = directory['VDMX']
    at = offset + 16 + 6*(ppem-1)
    assert struct.unpack_from('>H', out, at)[0] == ppem
    struct.pack_into('>h', out, at+2, struct.unpack_from('>h', out, at+2)[0]+4)
    struct.pack_into('>I', out, entry+4, checksum(out[offset:offset+length]))
    head = directory['head'][1]
    struct.pack_into('>I', out, head+8, 0)
    struct.pack_into('>I', out, head+8, (0xb1b0afba-checksum(out)) & 0xffffffff)
    assert checksum(out) == 0xb1b0afba
    return bytes(out)


def write_controls(target, cases, fonts):
    body = []
    for index, case in enumerate(cases):
        family = case['family']
        body.append('<w:p><w:pPr>' + ('<w:pageBreakBefore/>' if index else '') +
                    '</w:pPr><w:r><w:t>' + family + '</w:t></w:r></w:p>')
        for row in case['rows']:
            runs = []
            for text, active in [('START ', False), ('TEST', True), (' END', False)]:
                props = f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/><w:sz w:val="{row["size"]*2:g}"/>'
                if active: props += f'<w:vertAlign w:val="{row["script"]}"/>'
                runs.append('<w:r><w:rPr>'+props+'</w:rPr><w:t xml:space="preserve">'+text+'</w:t></w:r>')
            body.append('<w:p>'+''.join(runs)+'</w:p>')
    document = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join(body)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>'
    types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="officeDocument" Target="word/document.xml"/></Relationships>'.replace('Type="officeDocument"', 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"')
    with ZipFile(target/'controls.docx', 'w', ZIP_DEFLATED) as z:
        for name, value in {'[Content_Types].xml': types, '_rels/.rels': rels, 'word/document.xml': document}.items():
            info = ZipInfo(name, (2026, 10, 1, 12, 0, 0))
            info.create_system = 0; info.external_attr = 0o600 << 16
            z.writestr(info, value.encode(), compress_type=ZIP_DEFLATED)
    for name, value in [('cases.json', cases), ('fonts.json', fonts)]:
        (target/name).write_text(json.dumps(value, indent=2)+'\n', newline='\n')
    license = (ROOT/'tests/fixtures/script-metric-controls/OFL.txt').read_text()
    (target/'OFL.txt').write_text('\n'.join(line.rstrip() for line in license.splitlines())+'\n', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=TARGET)
    target = parser.parse_args().output
    target.mkdir(parents=True, exist_ok=True)
    cases, fonts = [], []
    for ppem in [None, 8, 10, 12, 13, 17, 20, 50, 83]:
        family = 'Script Size Probe ' + ('Base' if ppem is None else str(ppem))
        path = build(family, {'OS/2': {16: 700, 24: 700}}, target)
        linear = with_vdmx(path.read_bytes(), .95, .35)
        data = linear if ppem is None else perturb(linear, ppem)
        path.write_bytes(data)
        for tag, value in tables(linear).items():
            if tag not in [b'VDMX', b'head']: assert tables(data)[tag] == value
        fonts.append(path.name)
        rows = [dict(size=10, script=script) for script in ['superscript', 'subscript']]
        cases.append(dict(family=family, ppem=ppem, ascentDelta=0 if ppem is None else 4, rows=rows))
    write_controls(target, cases, fonts)
    print('Authored nine single-ppem font controls and 18 independent script rows')


if __name__ == '__main__': main()
