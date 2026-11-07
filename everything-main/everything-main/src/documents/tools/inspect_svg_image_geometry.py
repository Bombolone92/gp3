"""Read-only inventory of embedded SVG raster viewports; not renderer code.

Reports intrinsic bitmap size separately from authored image dimensions and
local aspect-ratio fitting. It does not resolve ancestor transforms or CSS.
Usage: python tools/inspect_svg_image_geometry.py input.docx output.json
"""
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from hashlib import sha256
import argparse
import base64
import json
import math
import re
from lxml import etree
from PIL import Image


def inspect(source):
    images = []
    with ZipFile(source) as package:
        for part in package.namelist():
            if not part.endswith('.svg'):
                continue
            data = package.read(part)
            root = etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True))
            for node in root.iter('{http://www.w3.org/2000/svg}image'):
                href = node.get('href') or node.get('{http://www.w3.org/1999/xlink}href', '')
                entry = dict(part=part, svgSha256=sha256(data).hexdigest(),
                             attributes={etree.QName(k).localname: v for k, v in node.attrib.items() if 'href' not in k})
                images.append(entry)
                if not re.match(r'^data:image/(?:png|jpeg);base64,', href):
                    entry['unresolved'] = 'Only embedded base64 PNG/JPEG data is inspected'
                    continue
                bitmap = base64.b64decode(re.sub(r'\s+', '', href.split(',', 1)[1]), validate=True)
                with Image.open(BytesIO(bitmap)) as image:
                    width, height = image.size
                entry.update(bitmapSha256=sha256(bitmap).hexdigest(), intrinsicSize=[width, height])
                values = [node.get('x', '0'), node.get('y', '0'), node.get('width', ''), node.get('height', '')]
                if not all(re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', v) for v in values):
                    entry['unresolved'] = 'Local fitting requires numeric image x/y/width/height'
                    continue
                x, y, viewport_width, viewport_height = map(float, values)
                if not all(math.isfinite(v) for v in [x, y, viewport_width, viewport_height]) or min(width, height, viewport_width, viewport_height) <= 0:
                    entry['unresolved'] = 'Nonfinite geometry or nonpositive dimensions'
                    continue
                entry['viewport'] = [x, y, viewport_width, viewport_height]
                preserve = node.get('preserveAspectRatio', 'xMidYMid meet').split()
                if preserve and preserve[0] == 'defer':
                    preserve.pop(0)
                if preserve == ['none']:
                    fitted = entry['viewport']
                elif preserve and re.fullmatch(r'x(?:Min|Mid|Max)Y(?:Min|Mid|Max)', preserve[0]) and (len(preserve) == 1 or len(preserve) == 2 and preserve[1] in ['meet', 'slice']):
                    align = re.fullmatch(r'x(Min|Mid|Max)Y(Min|Mid|Max)', preserve[0])
                    scale = (max if preserve[-1] == 'slice' else min)(viewport_width / width, viewport_height / height)
                    factors = {'Min': 0, 'Mid': .5, 'Max': 1}
                    fitted = [x + factors[align[1]] * (viewport_width - width * scale),
                              y + factors[align[2]] * (viewport_height - height * scale), width * scale, height * scale]
                else:
                    entry['unresolved'] = 'Unsupported preserveAspectRatio syntax'
                    continue
                entry['localFittedBounds'] = fitted
                entry['preserveAspectRatio'] = ' '.join(preserve)
    return dict(sourceSha256=sha256(Path(source).read_bytes()).hexdigest(), images=images)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(inspect(args.source), indent=2) + '\n', encoding='utf-8')
