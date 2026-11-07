"""Verify and measure original VDMX controls, using bounded native EMFs."""
import ctypes as C
from ctypes import wintypes as W
import json
import struct
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from record_script_position_metafiles import capture, verify_gdi, sha
from script_vdmx_fixture import tables, checksum

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'tests/fixtures/script-vdmx-position'


def device_metrics(data, family):
    """Read process-private GDI metrics; never install or persist fonts."""
    class TM(C.Structure):
        _fields_ = [(n, W.LONG) for n in ['height', 'ascent', 'descent', 'internal', 'external',
                                        'aveWidth', 'maxWidth', 'weight', 'overhang', 'aspectX', 'aspectY']] + \
                   [(n, W.WCHAR) for n in ['first', 'last', 'default', 'breakChar']] + \
                   [(n, W.BYTE) for n in ['italic', 'underlined', 'struckOut', 'pitch', 'charset']]
    g = C.WinDLL('gdi32', use_last_error=True)
    ptr, u, i = C.c_void_p, C.c_uint32, C.c_int32
    def api(name, args, result):
        f = getattr(g, name); f.argtypes, f.restype = args, result; return f
    add = api('AddFontMemResourceEx', [ptr, u, ptr, C.POINTER(u)], ptr)
    remove = api('RemoveFontMemResourceEx', [ptr], i)
    newdc = api('CreateCompatibleDC', [ptr], ptr)
    deldc = api('DeleteDC', [ptr], i)
    newfont = api('CreateFontIndirectW', [ptr], ptr)
    select = api('SelectObject', [ptr, ptr], ptr)
    delete = api('DeleteObject', [ptr], i)
    metric = api('GetTextMetricsW', [ptr, C.POINTER(TM)], i)
    face = api('GetTextFaceW', [ptr, i, W.LPWSTR], i)
    buffer, count = C.create_string_buffer(data), u()
    resource = add(buffer, len(data), None, C.byref(count)); assert resource and count.value
    dc = None; result = []
    try:
        dc = newdc(None); assert dc
        for ppem in [14, 24, 40]:
            raw = bytearray(92)
            struct.pack_into('<5i', raw, 0, -ppem, 0, 0, 0, 400)
            raw[24:28] = bytes([4, 64, 0, 34])
            name = family.encode('utf-16-le'); raw[28:28+len(name)] = name
            font = newfont(C.create_string_buffer(bytes(raw))); assert font
            old = select(dc, font)
            try:
                selected = C.create_unicode_buffer(64); assert face(dc, 64, selected)
                assert selected.value == family
                m = TM(); assert metric(dc, C.byref(m))
                result.append(dict(ppem=ppem, **{n: getattr(m, n) for n in ['ascent', 'descent', 'internal', 'external']}))
            finally:
                select(dc, old); delete(font)
    finally:
        if dc: deldc(dc)
        assert remove(resource)
    return result


def main():
    cases = json.loads((TARGET/'cases.json').read_text()); assert len(cases) == 12
    files = json.loads((TARGET/'fonts.json').read_text()); assert len(files) == 4
    base = tables((ROOT/'public/fonts/BebasNeue-Regular.ttf').read_bytes())
    for filename in files:
        data = (TARGET/filename).read_bytes(); t = tables(data)
        assert checksum(data) == 0xb1b0afba
        for tag in base:
            if tag in [b'head', b'name', b'DSIG', b'OS/2']: continue
            assert t[tag] == base[tag], tag
        expected = bytearray(base[b'OS/2'])
        for offset in [16, 24]: struct.pack_into('>h', expected, offset, 700)
        assert t[b'OS/2'] == expected
        assert t[b'head'][:8] == base[b'head'][:8] and t[b'head'][12:] == base[b'head'][12:]
        assert set(t) == set(base)-{b'DSIG'} | (set() if 'Absent' in filename else {b'VDMX'})
    w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    with ZipFile(TARGET/'controls.docx') as package:
        assert set(package.namelist()) == {'[Content_Types].xml', '_rels/.rels', 'word/document.xml'}
        paragraphs = ET.fromstring(package.read('word/document.xml')).find(w+'body').findall(w+'p')
        assert len(paragraphs) == 60
        for index, case in enumerate(cases):
            assert ''.join(paragraphs[index*5].itertext()) == case['family']
            for p, row in zip(paragraphs[index*5+1:index*5+5], case['rows']):
                runs = p.findall(w+'r'); assert [r.find(w+'t').text for r in runs] == ['START ', 'TEST', ' END']
                for k, r in enumerate(runs):
                    props = r.find(w+'rPr')
                    assert props.find(w+'rFonts').attrib == {w+'ascii': case['family'], w+'hAnsi': case['family']}
                    assert props.find(w+'sz').get(w+'val') == str(row['size']*2)
                    align = props.find(w+'vertAlign')
                    assert (align is None) if k != 1 else align.get(w+'val') == row['script']
    names = ['controls.docx', 'cases.json', 'fonts.json', *files]; results = []; devices = {}
    for index, case in enumerate(cases, 1):
        name = f'native-font-{index}.emf'; names.append(name)
        font = (TARGET/(case['family'].replace(' ', '')+'.ttf')).read_bytes()
        native, descriptions = capture((TARGET/name).read_bytes(), case, quantized_frame=True)
        results.append(dict(family=case['family'], variant=case['variant'], **native,
                            reselectedFontTables=verify_gdi(font, descriptions)))
        if case['family'] not in devices: devices[case['family']] = device_metrics(font, case['family'])
    output = dict(referenceBuild='16.0.20326', capture='Range.EnhMetaFileBits',
                  hashes={n: sha((TARGET/n).read_bytes()) for n in names},
                  baseFontSha256=sha((ROOT/'public/fonts/BebasNeue-Regular.ttf').read_bytes()),
                  cases=results, gdiMetrics=devices)
    (TARGET/'reference.json').write_text(json.dumps(output, indent=2)+'\n')
    for variant in ['Absent', 'Linear', 'Tall', 'Deep']:
        rows = [r for c in results if c['variant'] == variant for r in c['rows']]
        print(variant, [r['risePt'] for r in rows], devices['Script VDMX '+variant])
    print('Verified 48 native rows, all captured font tables, four original font derivatives and 60 source paragraphs')


if __name__ == '__main__': main()
