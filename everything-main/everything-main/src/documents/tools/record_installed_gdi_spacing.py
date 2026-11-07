"""Read installed-face spacing through GDI APIs; no font programs are read/copied."""
import argparse
import ctypes as C
from ctypes import wintypes as W
import json
from pathlib import Path


class ABC(C.Structure):
    _fields_ = [('a', W.FLOAT), ('b', W.FLOAT), ('c', W.FLOAT)]


class Pair(C.Structure):
    _fields_ = [('first', W.WORD), ('second', W.WORD), ('amount', W.INT)]


def record(families, sizes, dpi=600):
    # dpi converts point sizes to the requested logical font height; it does
    # not change a printer or the screen's configured resolution.
    if dpi <= 0 or any(size <= 0 for size in sizes):
        raise ValueError('Positive metric conversion and font sizes required')
    g = C.WinDLL('gdi32', use_last_error=True)
    g.CreateCompatibleDC.argtypes = [W.HDC]; g.CreateCompatibleDC.restype = W.HDC
    g.CreateFontW.argtypes = [W.INT] * 5 + [W.DWORD] * 8 + [W.LPCWSTR]; g.CreateFontW.restype = W.HFONT
    g.SelectObject.argtypes = [W.HDC, W.HGDIOBJ]; g.SelectObject.restype = W.HGDIOBJ
    g.GetTextFaceW.argtypes = [W.HDC, W.INT, W.LPWSTR]; g.GetTextFaceW.restype = W.INT
    g.GetCharABCWidthsFloatW.argtypes = [W.HDC, W.UINT, W.UINT, C.POINTER(ABC)]; g.GetCharABCWidthsFloatW.restype = W.BOOL
    g.GetKerningPairsW.argtypes = [W.HDC, W.DWORD, C.POINTER(Pair)]; g.GetKerningPairsW.restype = W.DWORD
    g.DeleteObject.argtypes = [W.HGDIOBJ]; g.DeleteDC.argtypes = [W.HDC]
    dc = g.CreateCompatibleDC(None)
    if not dc:
        raise C.WinError(C.get_last_error())
    output = []
    try:
        for family in families:
            for size in sizes:
                height = round(size * dpi / 72)
                font = g.CreateFontW(-height, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 0, 0, family)
                if not font:
                    raise C.WinError(C.get_last_error())
                old = g.SelectObject(dc, font)
                try:
                    name = C.create_unicode_buffer(128)
                    assert g.GetTextFaceW(dc, 128, name) and name.value == family, (family, name.value)
                    abc = (ABC * 95)()
                    if not g.GetCharABCWidthsFloatW(dc, 32, 126, abc):
                        raise C.WinError(C.get_last_error())
                    count = g.GetKerningPairsW(dc, 0, None)
                    pairs = (Pair * count)()
                    assert g.GetKerningPairsW(dc, count, pairs) == count
                    selected = {chr(p.first) + chr(p.second): p.amount * 72 / dpi for p in pairs
                                if chr(p.first) + chr(p.second) in ['Po', 'oe', 'et', 'tr', 'ry', 'AV', 'To', 'Wa', 'LY', 'Ya', 'Ta']}
                    output.append(dict(family=family, pointSize=size, dpi=dpi, pixelHeight=height,
                                       actualFace=name.value, kerningPairCount=count, selectedKerningPt=selected,
                                       advancesPt={chr(i + 32): (v.a + v.b + v.c) * 72 / dpi for i, v in enumerate(abc)}))
                finally:
                    g.SelectObject(dc, old); g.DeleteObject(font)
    finally:
        g.DeleteDC(dc)
    return dict(scope='Regular installed-face ASCII ABC widths and selected legacy GDI kerning pairs; not reference layout or a font-program extraction.', cases=output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--families', nargs='+', default=['Garamond', 'Arial', 'Times New Roman'])
    parser.add_argument('--sizes', nargs='+', type=float, default=[12, 17, 28, 60])
    parser.add_argument('--dpi', type=int, default=600)
    args = parser.parse_args()
    result = record(args.families, args.sizes, args.dpi)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    for case in result['cases']:
        print(case['family'], case['pointSize'], case['kerningPairCount'], case['selectedKerningPt'])
