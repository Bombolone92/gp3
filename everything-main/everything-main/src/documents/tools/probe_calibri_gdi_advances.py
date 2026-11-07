"""Windows API measurements against retained independent Calibri controls.

Reads LOGFONT descriptors and numeric references only. Does not read font
programs, glyph contours, engine implementations, or operate the reference application or its UI.
An exact face name does not establish matching font version or printer context.
"""
from pathlib import Path
import argparse
import ctypes as C
import hashlib
import json
import math
import struct

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/calibri-native-advances'


def probe(native_path):
    reference_bytes = (FIXTURE / 'native-page-pdf-origins.json').read_bytes()
    reference = json.loads(reference_bytes)
    data = native_path.read_bytes()
    capture = reference['default']['capture']
    assert hashlib.sha256(data).hexdigest() == capture['pageEmfSha256']
    assert capture['sourceUnchanged'] and capture['savedBefore'] and capture['savedAfter']
    assert capture['viewBefore'] == capture['viewAfter']
    assert capture['zoomBefore'] == capture['zoomAfter']
    assert hashlib.sha256((FIXTURE / 'default/control.docx').read_bytes()).hexdigest() == capture['sourceSha256']
    descriptors = []
    pos = 0
    while pos < len(data):
        kind, size = struct.unpack_from('<II', data, pos)
        assert size >= 8 and size % 4 == 0 and pos + size <= len(data)
        if kind == 82:
            assert size >= 104
            raw = data[pos+12:pos+104]
            name = raw[28:].decode('utf-16le').split('\0')[0]
            if name == 'Calibri' and struct.unpack_from('<i', raw, 16)[0] == 400:
                descriptors.append(raw)
        pos += size
    assert descriptors and all(d == descriptors[0] for d in descriptors)
    raw = descriptors[0]
    gdi = C.WinDLL('gdi32', use_last_error=True)
    def api(name, args, result):
        fn = getattr(gdi, name)
        fn.argtypes, fn.restype = args, result
        return fn
    ptr, integer, word = C.c_void_p, C.c_int32, C.c_uint16
    dcnew = api('CreateCompatibleDC', [ptr], ptr)
    dcdel = api('DeleteDC', [ptr], integer)
    fontnew = api('CreateFontIndirectW', [ptr], ptr)
    objdel = api('DeleteObject', [ptr], integer)
    select = api('SelectObject', [ptr, ptr], ptr)
    face = api('GetTextFaceW', [ptr, integer, C.c_wchar_p], integer)
    graphics = api('SetGraphicsMode', [ptr, integer], integer)
    class Size(C.Structure):
        _fields_ = [('cx', integer), ('cy', integer)]
    class ABC(C.Structure):
        _fields_ = [('a', C.c_float), ('b', C.c_float), ('c', C.c_float)]
    measure = api('GetTextExtentExPointW', [ptr, C.c_wchar_p, integer, integer,
                   C.POINTER(integer), C.POINTER(integer), C.POINTER(Size)], integer)
    abc = api('GetCharABCWidthsFloatW', [ptr, C.c_uint32, C.c_uint32, C.POINTER(ABC)], integer)
    justify = C.WinDLL('usp10').ScriptJustify
    justify.argtypes = [C.POINTER(word), C.POINTER(integer), integer, integer, integer, C.POINTER(integer)]
    justify.restype = integer
    results = {}
    for mode in [1, 2]:
        dc = dcnew(None)
        assert dc
        font, old = None, None
        try:
            assert graphics(dc, mode)
            font = fontnew(C.create_string_buffer(raw))
            assert font
            old = select(dc, font)
            assert old
            name = C.create_unicode_buffer(128)
            assert face(dc, 128, name) and name.value == 'Calibri'
            rows, widths = [], {}
            for row in reference['default']['rows']:
                text = row['case']['text']
                assert 0 < len(text) <= 1024
                dx, fit, size = (integer * len(text))(), integer(), Size()
                assert measure(dc, text, len(text), 2147483647, C.byref(fit), dx, C.byref(size))
                assert fit.value == len(text)
                advances = [dx[i] - (dx[i-1] if i else 0) for i in range(len(text))]
                for char in text:
                    if char not in widths:
                        value = ABC()
                        assert abc(dc, ord(char), ord(char), C.byref(value))
                        widths[char] = value.a + value.b + value.c
                candidates = {'gdi': advances}
                desired = math.floor(sum(row['canvasAdvancesPt']) / .12 + .5)
                for rule in ['all-character', 'interword-priority', 'exclude-terminal']:
                    attrs = [(4 if c.isspace() and rule != 'all-character' else 2) | 16 for c in text]
                    if rule == 'exclude-terminal':
                        attrs[-1] = 16
                    flags, source, output = (word * len(text))(*attrs), (integer * len(text))(*advances), (integer * len(text))()
                    assert justify(flags, source, len(text), desired-sum(advances), 0, output) >= 0
                    candidates[rule] = list(output)
                comparison = {}
                for rule, candidate in candidates.items():
                    origins, x = [], row['nativePageXPt'][0]
                    for char, width in zip(text, candidate, strict=True):
                        if not char.isspace():
                            origins.append(x)
                        x += width * .12
                    error = [abs(a-b) for a, b in zip(origins, row['nativePageXPt'], strict=True)]
                    comparison[rule] = dict(advances=candidate, exactOrigins=sum(v < 1e-9 for v in error), maxOriginErrorPt=max(error))
                rows.append(dict(index=row['case']['index'], text=text, sourceDerivedTotal=desired,
                                 nativeTotal=sum(row['nativePageAdvances600dpi']), comparisons=comparison))
            results[str(mode)] = dict(abcWidthsLogical=widths, rows=rows)
        finally:
            if old:
                select(dc, old)
            if font:
                objdel(font)
            dcdel(dc)
    assert results['1'] == results['2']
    summary = {rule: dict(exactOrigins=sum(r['comparisons'][rule]['exactOrigins'] for r in results['1']['rows']),
                         maximumOriginErrorPt=max(r['comparisons'][rule]['maxOriginErrorPt'] for r in results['1']['rows']))
               for rule in ['gdi', 'all-character', 'interword-priority', 'exclude-terminal']}
    return dict(scope='Captured LOGFONT, installed GDI API measurements and declared diagnostic justification attributes. '
                      'No font-version/printer-context equivalence, native algorithm or render-fidelity claim.',
                referenceSha256=hashlib.sha256(reference_bytes).hexdigest(),
                nativeSha256=hashlib.sha256(data).hexdigest(), logfontHex=raw.hex(),
                actualFace='Calibri', graphicsModesIdentical=True, summary=summary, results=results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('native_metafile', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a fresh output; existing evidence is never overwritten.')
    result = probe(args.native_metafile)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps(result['summary']))
