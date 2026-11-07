"""Conservative corpus candidates for absolute cubic SVG group coverage.

Include any SVG part containing opacity declarations and an absolute C command.
This includes unused resources and unsupported transforms, not just proven
runtime consumers. Save only paths/hashes; never redistribute corpus artwork.
"""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
import argparse
import json
from lxml import etree


def find(root,all_groups=False):
    rows = []
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    sources = sorted(p for p in root.rglob('*.docx') if not p.name.startswith('~$'))
    for source in sources:
        parts = []
        with ZipFile(source) as archive:
            for name in archive.namelist():
                if not name.lower().endswith('.svg'):
                    continue
                data = archive.read(name)
                if b'opacity' not in data.lower():
                    continue
                svg = etree.fromstring(data, parser)
                if any(node.tag=='{http://www.w3.org/2000/svg}g' if all_groups else 'C' in node.get('d', '') for node in svg.iter()):
                    parts.append(dict(path=name, sha256=sha256(data).hexdigest(), bytes=len(data)))
        if parts:
            rows.append(dict(file=source.relative_to(root).as_posix(),
                             sourceSha256=sha256(source.read_bytes()).hexdigest(), parts=parts))
    return dict(scope='Conservative SVG opacity/group resource candidates, including unused resources and unverified transforms.' if all_groups else __doc__, scannedSources=len(sources), rows=rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--all-groups',action='store_true',help='Select any SVG with opacity and a group, regardless of path grammar.')
    args = parser.parse_args()
    result = find(args.root,args.all_groups)
    args.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(f"{len(result['rows'])} candidates across {result['scannedSources']} DOCX sources")
