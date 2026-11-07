"""Validate and package the store delivery. Requires Pillow, never edits app code."""
from pathlib import Path
from PIL import Image
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / 'store'
SIZES = [(1920, 1080), (1024, 768), (1080, 2280)]
NAMES = ['01-ownership.png', '02-fundraising.png', '03-hiring.png', '04-exit.png']

listing = (ROOT / 'STORE_LISTING.md').read_text()
short = listing.split('## Short description\n\n')[1].split('\n\n')[0]
tagline = re.search(r'^\*([^*\n]+)\*$', listing, flags=re.M).group(1)
assert '**' not in listing
assert len(short) < 170, len(short)
assert len(tagline) < 30, len(tagline)
assert '\u2014' not in listing
long_copy = listing.split('## Long description\n\n')[1].split('\n## ')[0]
assert 2 <= len(long_copy.strip().split('\n\n')) <= 4
features = listing.split('## Key features\n\n')[1].split('\n## ')[0]
assert 5 <= len(re.findall(r'^- ', features, flags=re.M)) <= 8

report = json.loads((STORE / 'source/render-report.json').read_text())
assert len(report) == 12
assert len(list((STORE / 'screenshots').rglob('*.png'))) == 12
for row in report:
    assert row['theme'] == 'light'
    assert not row['truncated']
    assert 3 <= len(row['title'].split()) <= 7
    assert '\u2014' not in row['text']
    assert not re.search(r'https?://|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|app|dev|example)\b', row['text'], re.I)
    assert not re.search(r'lorem ipsum|placeholder|unknown holder|nothing issued|undefined', row['text'], re.I)
    assert row['showcase']['bottom'] < row['height'] - 25

records = []
previews = STORE / 'previews'
previews.mkdir(exist_ok=True)
for width, height in SIZES:
    size = f'{width}x{height}'
    directory = STORE / 'screenshots' / size
    assert sorted(p.name for p in directory.glob('*.png')) == NAMES
    scale = 0.4 if width != 1080 else 0.32
    images = []
    for name in NAMES:
        path = directory / name
        with Image.open(path) as image:
            assert image.size == (width, height), (path, image.size)
            assert image.mode == 'RGB', (path, image.mode)
            image.verify()
        image = Image.open(path)
        preview = image.resize((round(width * scale), round(height * scale)), Image.Resampling.LANCZOS)
        preview.save(previews / f'{size}-{path.stem}.jpg', quality=94)
        images.append(preview)
        if width == 1920:
            image.resize((576, 324), Image.Resampling.LANCZOS).save(previews / f'{size}-{path.stem}-30pct.jpg', quality=94)
        records.append({
            'path': f'screenshots/{size}/{name}', 'width': width, 'height': height,
            'format': 'PNG', 'color_mode': 'RGB',
            'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        })
    gap = 20
    tile_w, tile_h = images[0].size
    sheet = Image.new('RGB', (tile_w * 2 + gap * 3, tile_h * 2 + gap * 3), '#e8ebe8')
    for i, image in enumerate(images):
        sheet.paste(image, (gap + (i % 2) * (tile_w + gap), gap + (i // 2) * (tile_h + gap)))
    sheet.save(previews / f'{size}-contact-sheet.jpg', quality=94)

manifest = {
    'app': 'Cap Table', 'asset_count': len(records), 'ui_theme': 'light',
    'reference_date': '2026-09-05',
    'tagline_characters': len(tagline), 'short_description_characters': len(short),
    'assets': records,
}
(STORE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
archive = STORE / 'captable-store-assets.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
    bundle.write(ROOT / 'STORE_LISTING.md', 'STORE_LISTING.md')
    bundle.write(STORE / 'README.md', 'store/README.md')
    bundle.write(STORE / 'manifest.json', 'store/manifest.json')
    for record in records:
        bundle.write(STORE / record['path'], f"store/{record['path']}")
print(f'Verified {len(records)} RGB PNGs across all three exact sizes.')
print(f'Tagline: {len(tagline)} characters. Short description: {len(short)} characters.')
print(f'Delivery ZIP: {archive.relative_to(ROOT)} ({archive.stat().st_size:,} bytes)')
