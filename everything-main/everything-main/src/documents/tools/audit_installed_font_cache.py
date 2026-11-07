"""Read cloud-font cache catalog JSON and filesystem metadata; never read font programs.

Cache presence does not prove an OS registration, browser availability, matching
font version, glyph fidelity, or rights to use the font outside the application that cached it. This
tool does not download, install, activate, copy, convert or serve any fonts.
"""
from pathlib import Path
import argparse
import hashlib
import json


def audit(root, families):
    catalog_path = root/'Catalog/ListAll.Json'
    data = catalog_path.read_bytes()
    catalog = json.loads(data.decode('utf-8-sig'))
    rows = []
    for family in families:
        entries = [f for f in catalog['Fonts'] if f['f'].casefold() == family.casefold()]
        face_alias = not entries
        if face_alias:
            entries = [f for f in catalog['Fonts'] if any(
                face.get('dn', '').casefold() == family.casefold() for face in f.get('sf', []))]
        files = []
        for entry in entries:
            for face in entry.get('sf', []):
                if face_alias and face.get('dn', '').casefold() != family.casefold():
                    continue
                filename = str(face['id'])+'.'+face['t']
                path = root/'CloudFonts'/entry['f']/filename
                present = path.is_file()
                files.append(dict(face=face['dn'], filename=filename, present=present,
                                  length=path.stat().st_size if present else None,
                                  catalogLength=face.get('fs'), catalogVersion=face.get('v')))
        rows.append(dict(family=family, catalogFound=bool(entries),
                         presentFaces=sum(f['present'] for f in files), faces=files,
                         **(dict(matchedAs='face',catalogFamilies=[f['f'] for f in entries])
                            if face_alias and entries else {})))
    return dict(scope=__doc__, catalogSha256=hashlib.sha256(data).hexdigest(),
                catalogVersion=[catalog['MajorVersion'], catalog['MinorVersion']], families=rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache_root', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--family', action='append', required=True)
    args = parser.parse_args()
    result = audit(args.cache_root, args.family)
    with args.output.open('x', encoding='utf-8') as report:
        report.write(json.dumps(result, indent=2)+'\n')
    print(f"{sum(f['presentFaces'] for f in result['families'])} cached faces across "
          f"{len(result['families'])} families; metadata only, no activation")
