"""Measure graphical border paths without reading PDF font programs or copying art."""
import argparse
import hashlib
import json
from pathlib import Path
from pypdf import PdfReader


def digest(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':')).encode()).hexdigest()


def inspect(pdf):
    result = []
    for page in PdfReader(pdf).pages:
        paths, path, state, stack = [], [], {'matrix': [1, 0, 0, 1, 0, 0], 'color': None, 'clips': []}, []
        def point(x, y):
            a, b, c, d, e, f = state['matrix']
            return [round(a*x+c*y+e, 6), round(b*x+d*y+f, 6)]
        for operands, op in page.get_contents().operations:
            if op == b'q':
                stack.append(json.loads(json.dumps(state)))
            elif op == b'Q':
                state = stack.pop()
            elif op == b'cm':
                a, b, c, d, e, f = map(float, operands)
                A, B, C, D, E, F = state['matrix']
                state['matrix'] = [A*a+C*b, B*a+D*b, A*c+C*d, B*c+D*d, A*e+C*f+E, B*e+D*f+F]
            elif op == b'rg':
                state['color'] = list(map(float, operands))
            elif op in (b'm', b'l'):
                path.append([op.decode(), *point(*map(float, operands))])
            elif op == b'h':
                path.append(['h'])
            elif op == b're':
                x, y, w, h = map(float, operands)
                path.extend([['m', *point(x, y)], ['l', *point(x+w, y)], ['l', *point(x+w, y+h)], ['l', *point(x, y+h)], ['h']])
            elif op in (b'W', b'W*'):
                state['clips'].append(digest(path))
            elif op == b'n':
                path = []
            elif op in (b'f', b'f*'):
                if path:
                    points = [p[1:] for p in path if p[0] in ('m', 'l')]
                    if points:
                        paths.append({'sha256': digest(path), 'clipSha256': digest(state['clips']), 'commands': len(path),
                                      'color': state['color'], 'boundsPt': [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]})
                path = []
            elif op in (b'c', b'v', b'y', b'S', b's', b'B', b'B*', b'b', b'b*', b'Do'):
                raise ValueError('Reference is no longer a line-only filled-path control: '+op.decode())
        result.append({'pageSizePt': list(map(float, page.mediabox[2:])), 'paths': paths})
    return {'pdfSha256': hashlib.sha256(Path(pdf).read_bytes()).hexdigest(), 'pages': result,
            'page7EqualsAsymmetric': result[1]['paths'] == result[5]['paths']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = inspect(args.pdf)
    args.output.write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'pages': len(data['pages']), 'filledPaths': [len(p['paths']) for p in data['pages']], 'page7EqualsAsymmetric': data['page7EqualsAsymmetric']}))
