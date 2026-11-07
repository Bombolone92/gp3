"""Original integer-coordinate curves isolating adaptive cubic step changes."""
from pathlib import Path
import argparse
import json
import canvas_svg_fixture as fixture

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/svg-cubic-step-changes'


def split(points):
    midpoint = lambda a, b: [(x+y)/2 for x, y in zip(a, b, strict=True)]
    a, b, c = [midpoint(points[i], points[i+1]) for i in range(3)]
    d, e = midpoint(a, b), midpoint(b, c)
    center = midpoint(d, e)
    return [[points[0], a, d, center], [center, e, c, points[3]]]


def generate(out=OUT, split_curves=False):
    out.mkdir(parents=True, exist_ok=True)
    cases, groups, api_cases = [], [], []
    for shape, width, height, x in [
        ('s', 1, 63, 2), ('s', 1, 127, 22),
        ('s', 16, 63, 62), ('s', 16, 127, 92),
        ('s', 64, 127, 122), ('s', 64, 255, 212),
        ('backtrack', 255, 63, 312), ('backtrack', 255, 127, 592),
    ]:
        y = 270
        points = [[x, y], [x+width, y+height],
                  [x, y-height if shape == 's' else y+height], [x+width, y]]
        segments = split(points) if split_curves else [points]
        path = ('M' + ' '.join(map(str, points[0])) +
                ''.join('C'+' '.join(str(v) for point in segment[1:] for v in point)
                        for segment in segments) + 'Z')
        name = f'{shape}-{width}-{height}'
        case = dict(name=name, points=points, path=path)
        if split_curves:
            case['segments'] = segments
            for side, segment in zip(['left', 'right'], segments, strict=True):
                api_cases.append(dict(name=name+'-'+side, parent=name, side=side, points=segment))
        cases.append(case)
        groups.append(f'<g opacity=".8"><path d="{path}" fill="#2060C0"/></g>')
    fixture.SOURCE = out / 'control.docx'
    fixture.SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" '
                   'viewBox="0 0 1000 600">' + ''.join(groups) + '</svg>').encode()
    fixture.generate()
    (out / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')
    if split_curves:
        (out/'api-cases.json').write_text(json.dumps(api_cases, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--split', action='store_true')
    args = parser.parse_args()
    generate(args.output_dir or (OUT.with_name('svg-cubic-step-split') if args.split else OUT), args.split)
