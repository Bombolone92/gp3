"""Record native text scene equivalence without relying on PDF byte identity."""
from pathlib import Path
import hashlib
import json
from collections import Counter
import pypdfium2 as pdf

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/text-3d'


def main():
    cases = json.loads((ROOT / 'scene-cases.json').read_text())
    document = pdf.PdfDocument(ROOT / 'scene-native.pdf')
    assert len(document) == len(cases) == 8
    records = []
    for case, page in zip(cases, document):
        page_image = page.render(scale=4).to_pil().convert('RGB')
        image = page_image.crop((260, 460, 1120, 960))
        colors = Counter(image.getdata())
        records.append({**case, 'glyphRegionSha256': hashlib.sha256(image.tobytes()).hexdigest(),
                        'dominantColors': [{'rgb': list(rgb), 'pixels': count} for rgb, count in colors.most_common(5)],
                        'planeSamples': [{'xPt': x, 'yPt': y, 'rgb': list(page_image.getpixel((x*4, y*4)))}
                                         for x, y in [(118, 137), (118, 131)]]})
    for omitted, explicit in [(0, 1), (4, 5)]:
        assert records[omitted]['glyphRegionSha256'] == records[explicit]['glyphRegionSha256']
    digest = lambda name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    result = {'referenceVersion': '16.0.20326', 'sourceSha256': digest('scene-control.docx'),
              'pdfSha256': digest('scene-native.pdf'), 'renderScale': 4,
              'glyphRegionPixels': [260, 460, 1120, 960], 'records': records}
    (ROOT / 'scene-reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print('Eight native scene pages recorded; both omitted/threePt glyph-region pairs are RGB-identical.')


if __name__ == '__main__':
    main()
