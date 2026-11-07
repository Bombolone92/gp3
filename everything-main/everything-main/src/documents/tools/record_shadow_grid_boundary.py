"""Hash-bound native shadow grid metadata, keeping metafile and PDF paths distinct."""
from pathlib import Path
import argparse
import hashlib
import json
import struct
from native_shadow_images import native_images

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/shadow-grid-boundary'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def image_geometry(path):
    """Recorded SetWorldTransform and DrawImagePoints, not a screen oracle."""
    data = Path(path).read_bytes()
    pos, transform, drawings = 0, None, []
    while pos < len(data):
        kind, size = struct.unpack_from('<II', data, pos)
        if size < 8 or pos + size > len(data):
            raise ValueError('Invalid metafile record extent')
        if kind == 70 and data[pos + 12:pos + 16] == b'EMF+':
            at = pos + 16
            while at < pos + size:
                tag, flags, length, count = struct.unpack_from('<HHII', data, at)
                if length < 12 or at + length > pos + size or count > length - 12:
                    raise ValueError('Invalid EMF+ record extent')
                payload = data[at + 12:at + 12 + count]
                if tag == 0x402A:
                    transform = list(struct.unpack('<6f', payload))
                elif tag == 0x402B:
                    transform = [1, 0, 0, 1, 0, 0]
                elif tag in range(0x402C, 0x4030):
                    raise ValueError('Unimplemented world-transform composition')
                elif tag == 0x4030 and (flags != 2 or struct.unpack('<f', payload)[0] != 1):
                    raise ValueError('Unimplemented native page transform')
                elif tag == 0x401B:
                    if transform is None or flags & 0x0800 or struct.unpack_from('<I', payload, 24)[0] != 3:
                        raise ValueError('Unsupported native image geometry')
                    drawings.append(dict(imageId=flags & 255, setWorldTransform=transform,
                                         sourceRect=list(struct.unpack_from('<4f', payload, 8)),
                                         points=list(struct.unpack_from('<6h' if flags & 0x4000 else '<6f', payload, 28))))
                at += length
        pos += size
    if len(drawings) != 2:
        raise ValueError('Expected shadow and source image draws')
    return drawings


def record(folder, pdf=None):
    folder = Path(folder)
    capture = json.loads((folder / 'capture.json').read_text(encoding='utf-8-sig'))
    if sha(FIXTURE / 'source.docx') != capture['sourceSha256']:
        raise ValueError('Source hash differs from native capture')
    if sha(FIXTURE / 'cases.json') != capture['casesSha256']:
        raise ValueError('Case inventory differs from native capture')
    if not capture['sourceUnchanged'] or capture['savedBefore'] != capture['savedAfter']:
        raise ValueError('Source bytes or saved state changed')
    if capture['viewBefore'] != capture['viewAfter']:
        raise ValueError('Native view changed')
    cases = json.loads((FIXTURE / 'cases.json').read_text())
    if capture['pages'] != len(cases) or len(capture['captures']) != len(cases):
        raise ValueError('Incomplete native capture')
    pdf_pages = None
    if pdf:
        from pypdf import PdfReader
        if sha(pdf) != capture.get('pdfSha256'):
            raise ValueError('PDF hash differs from native capture')
        pdf_pages = PdfReader(pdf).pages
        if len(pdf_pages) != len(cases):
            raise ValueError('Wrong PDF page count')
    rows = []
    for case, entry, shape in zip(cases, capture['captures'], capture['nativeShapeProperties'], strict=True):
        page = case['page']
        if entry['page'] != page or shape['page'] != page or shape['name'] != case['name']:
            raise ValueError('Native identity mismatch')
        # Use the known basename, never an arbitrary path from metadata.
        emf = folder / f'page-{page}.emf'
        if entry['file'] != emf.name or sha(emf) != entry['sha256']:
            raise ValueError('Native metafile changed')
        images = native_images(emf)
        if images[1]['size'] != [32, 32] or images[1]['centerRgba'] != [0, 0, 0, 255]:
            raise ValueError('Wrong independently authored source rectangle')
        row = dict(**case, nativeShapeProperties=shape, emfSha256=entry['sha256'], images=images,
                   drawGeometry=image_geometry(emf))
        if pdf_pages is not None:
            # Dictionary metadata only: no font dictionaries/programs or image
            # streams are decoded. Do not use PdfReader.page.images here.
            resources = pdf_pages[page - 1]['/Resources'].get_object()
            xobjects = resources['/XObject'].get_object()
            found = []
            for key, reference in xobjects.items():
                obj = reference.get_object()
                if obj.get('/Subtype') == '/Image':
                    found.append(dict(name=str(key), size=[int(obj['/Width']), int(obj['/Height'])], hasMask=bool(obj.get('/SMask'))))
            masked = [image for image in found if image['hasMask']]
            if len(found) != 2 or len(masked) != 1:
                raise ValueError('Ambiguous PDF shadow image')
            row['pdfImages'] = found
            row['pdfShadowSize'] = masked[0]['size']
        rows.append(row)
    return dict(sourceSha256=capture['sourceSha256'], casesSha256=capture['casesSha256'],
                captureSha256=sha(folder / 'capture.json'), referenceBuild=capture['referenceBuild'],
                savedBefore=capture['savedBefore'], savedAfter=capture['savedAfter'], sourceUnchanged=True,
                viewBefore=capture['viewBefore'], viewAfter=capture['viewAfter'],
                pdfSha256=capture.get('pdfSha256') if pdf else None,
                scope='Native exported shadow PNG metadata and optional PDF image dictionary dimensions; not a screen, internal layout, blur kernel or full-image fidelity oracle.',
                cases=rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_folder', type=Path)
    parser.add_argument('--pdf', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a fresh report destination; preserve source/evidence files.')
    report = record(args.capture_folder, args.pdf)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    for case in report['cases']:
        print(case['name'], 'metafile', case['images'][0]['size'], 'PDF', case.get('pdfShadowSize'))
