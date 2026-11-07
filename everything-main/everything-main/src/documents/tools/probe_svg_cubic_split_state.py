"""Compare equivalent original whole/split curves against API and native references.

Exact rational Bernstein evaluations establish equality of each degree-three
half-polynomial at four distinct parameters. Raster comparisons are native PNG
RGBA samples; browser color decoding and editing use separate browser tests.
No captured contour or curve selector is used by production rendering.
"""
from pathlib import Path
from fractions import Fraction
import argparse
import hashlib
import json
from zipfile import ZipFile
from xml.etree import ElementTree
import numpy as np
from PIL import Image
from probe_svg_cubic_arithmetic import candidate
from svg_cubic_step_fixture import split

ROOT = Path(__file__).resolve().parents[1]/'tests/fixtures'
sha = lambda data: hashlib.sha256(data).hexdigest()
read = lambda path: json.loads(path.read_text(encoding='utf-8-sig'))


def evaluate(points, t):
    weights = [(1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3]
    return [sum(Fraction(str(p[k]))*w for p, w in zip(points, weights, strict=True))
            for k in range(2)]


def references(folder, api_input):
    cases, native = read(folder/api_input), read(folder/'native-api.json')
    assert native['inputSha256'] == sha((folder/api_input).read_bytes())
    assert native['quantizeInput'] and native['tolerance'] == .25
    manifest = read(folder/'metafile-reference.json')
    for name, key in [('control.docx', 'sourceSha256'), ('cases.json', 'casesSha256'),
                      ('capture.emf', 'captureSha256'), ('capture.json', 'captureMetadataSha256'),
                      ('native.emf', 'nativeSha256')]:
        assert sha((folder/name).read_bytes()) == manifest[key]
    for image in manifest['images']:
        assert sha((folder/image['path']).read_bytes()) == image['sha256']
    document_cases = read(folder/'cases.json')
    with ZipFile(folder/'control.docx') as package:
        svg = ElementTree.fromstring(package.read('word/media/vector.svg'))
    paths = svg.findall('{http://www.w3.org/2000/svg}g/{http://www.w3.org/2000/svg}path')
    assert len(paths) == len(document_cases)
    for path, case in zip(paths, document_cases, strict=True):
        assert path.attrib['d'] == case['path']
    assert len(cases) == len(native['cases'])
    for c, n in zip(cases, native['cases'], strict=True):
        assert c['name'] == n['name']
    return cases, native['cases'], manifest


def probe():
    whole_folder, split_folder = [ROOT/name for name in
                                  ['svg-cubic-step-changes', 'svg-cubic-step-split']]
    cases, whole_native, whole_ref = references(whole_folder, 'cases.json')
    half_cases, half_native, split_ref = references(split_folder, 'api-cases.json')
    split_cases = read(split_folder/'cases.json')
    with ZipFile(whole_folder/'control.docx') as a, ZipFile(split_folder/'control.docx') as b:
        assert set(a.namelist()) == set(b.namelist())
        assert [name for name in a.namelist() if a.read(name) != b.read(name)] == ['word/media/vector.svg']
    assert len(half_cases) == 2*len(cases) == len(half_native)
    assert len(cases) == len(split_cases) == len(whole_ref['images']) == len(split_ref['images'])
    rows = []
    for i, (case, split_case) in enumerate(zip(cases, split_cases, strict=True)):
        assert case['name'] == split_case['name'] and case['points'] == split_case['points']
        halves = split(case['points'])
        assert halves == split_case['segments']
        for side, half in enumerate(halves):
            api_case = half_cases[2*i+side]
            assert api_case['parent'] == case['name'] and api_case['points'] == half
            # Every input is already exactly on the API's 1/16 lattice.
            assert all((Fraction(str(v))*16).denominator == 1 for p in half for v in p)
            for t in [Fraction(0), Fraction(1, 3), Fraction(2, 3), Fraction(1)]:
                assert evaluate(half, t) == evaluate(case['points'], (side+t)/2)
        native_whole = np.array(whole_native[i]['points']).reshape(-1, 2)
        native_halves = np.concatenate([np.array(half_native[2*i]['points']).reshape(-1, 2),
                                       np.array(half_native[2*i+1]['points']).reshape(-1, 2)[1:]])
        current_whole = candidate(np.array(case['points'], dtype=float))
        current_halves = np.concatenate([candidate(np.array(halves[0], dtype=float)),
                                        candidate(np.array(halves[1], dtype=float))[1:]])
        differences = None
        if native_whole.shape == native_halves.shape:
            differences = [dict(index=int(at), whole=native_whole[at].tolist(),
                                split=native_halves[at].tolist())
                           for at in np.where(np.any(native_whole != native_halves, axis=1))[0]]
        a_ref, b_ref = whole_ref['images'][i], split_ref['images'][i]
        assert a_ref['size'] == b_ref['size'] and a_ref['transform'] == b_ref['transform']
        a = np.array(Image.open(whole_folder/a_ref['path']).convert('RGBA'))
        b = np.array(Image.open(split_folder/b_ref['path']).convert('RGBA'))
        rows.append(dict(case=case['name'], polynomialIdentityVerified=True,
                         nativeVertexCounts=[len(native_whole), len(native_halves)],
                         nativeContoursEqual=bool(np.array_equal(native_whole, native_halves)),
                         nativeVertexDifferences=differences,
                         currentContoursEqual=bool(np.array_equal(current_whole, current_halves)),
                         nativeRasterAlphaDifferences=int(np.count_nonzero(a[:, :, 3] != b[:, :, 3])),
                         nativeRasterVisibleRgbDifferences=int(np.count_nonzero(
                             np.any(a[:, :, :3] != b[:, :, :3], axis=2) & ((a[:, :, 3]>0) | (b[:, :, 3]>0))))))
    return dict(scope=__doc__, referenceHashes={str(folder.relative_to(ROOT))+'/'+name:sha((folder/name).read_bytes())
                for folder, names in [(whole_folder, ['cases.json', 'native-api.json', 'metafile-reference.json']),
                                      (split_folder, ['api-cases.json', 'native-api.json', 'metafile-reference.json'])]
                for name in names}, rows=rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = probe()
    args.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(f"{sum(not r['nativeContoursEqual'] for r in result['rows'])}/8 native contours differ; "
          f"{sum(r['nativeRasterAlphaDifferences'] for r in result['rows'])} native alpha pixels differ")
