"""Original full/split cubic controls across a native sampling discontinuity.

No corpus geometry, artwork, fonts or third-party document engine is used.
The API and reference raster observations must be recorded separately.
"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse, json
from svg_cubic_step_fixture import split

ROOT = Path(__file__).resolve().parents[1]
HEIGHTS = [510, 511, 511.5, 511.9375, 512, 513, 900, 1020]


def generate(out):
    out.mkdir(parents=True, exist_ok=True)
    with ZipFile(ROOT/'tests/fixtures/svg-cubic-step-changes/control.docx') as z:
        parts = {name: z.read(name) for name in z.namelist()}
    cases, groups, api = [], [], []
    for height in HEIGHTS:
        for representation in ('whole', 'split'):
            x, y = 2 + len(cases)*288, 300
            points = [[x, y], [x+256, y+height], [x, y-height], [x+256, y]]
            segments = [points] if representation == 'whole' else split(points)
            path = 'M'+' '.join(map(str, points[0]))+''.join(
                'C'+' '.join(str(v) for point in segment[1:] for v in point)
                for segment in segments)+'Z'
            name = f'h{height}/{representation}'
            cases.append(dict(name=name, height=height, representation=representation,
                              points=points, segments=segments, path=path))
            groups.append(f'<g opacity=".8"><path d="{path}" fill="#2060C0"/></g>')
            for index, segment in enumerate(segments):
                api.append(dict(name=f'{name}/{index}', points=segment))
    parts['word/media/vector.svg'] = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="4628" height="600" '
        'viewBox="0 0 4628 600">'+''.join(groups)+'</svg>').encode()
    with ZipFile(out/'control.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 10, 3, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    for name, data in [('cases.json', cases), ('api-cases.json', api)]:
        (out/name).write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    generate(parser.parse_args().output)
