"""Independent multi-page recto/verso holdout, frozen before native capture."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from copy import deepcopy
import hashlib
import json
import argparse
from lxml import etree as E
from aligned_multipage_floating_fixture import W, paragraph, section

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-directory', type=Path, default=ROOT / 'tests/fixtures/aligned-floating-parity-holdout')
parser.add_argument('--horizontal-anchor', choices=['margin', 'page', 'text'], default='margin')
parser.add_argument('--compatibility-mode', type=int, choices=[12, 15], default=15)
parser.add_argument('--cell-left', type=int, choices=[72, 108, 216], default=108)
parser.add_argument('--cell-right', type=int, choices=[72, 108, 216], default=108)
parser.add_argument('--rows', type=int, choices=[3, 18], default=18)
parser.add_argument('--center', action='store_true')
parser.add_argument('--numbering-restart', type=int, choices=[0, 1, 2])
parser.add_argument('--initial-number', type=int, choices=[0, 1, 2])
parser.add_argument('--leading-first', action='store_true')
parser.add_argument('--mirror-margins', action='store_true')
args = parser.parse_args()
DEST = args.output_directory
variant = (args.horizontal_anchor, args.compatibility_mode, args.cell_left, args.cell_right, args.rows, args.center) != ('margin', 15, 108, 108, 18, False)
variant = variant or args.numbering_restart is not None or args.initial_number is not None or args.leading_first or args.mirror_margins
if variant and DEST == ROOT / 'tests/fixtures/aligned-floating-parity-holdout':
    parser.error('Variant generation requires a separate output directory')
BASE = ROOT / 'tests/fixtures/aligned-multipage-floating/control.docx'
assert hashlib.sha256(BASE.read_bytes()).hexdigest() == 'cdd9be38c2bd654ce89ef01a60d26f94977715b0fc5789e9258ddd83e9ee335b'
with ZipFile(BASE) as archive:
    parts = {name: archive.read(name) for name in archive.namelist()}
source = E.fromstring(parts['word/document.xml'])
prototype = source.find(f'.//{{{W}}}tbl')
document = E.fromstring(f'<w:document xmlns:w="{W}"><w:body/></w:document>'.encode())
body = document.find(f'{{{W}}}body')
def page_end(label):
    return E.fromstring(paragraph(label, f'<w:pPr>{section()}</w:pPr>').replace('<w:p>', f'<w:p xmlns:w="{W}">', 1).encode())
body.append(page_end('Leading parity page'))
span = 2 if args.rows == 18 else 1
starts = [1, 2 + span, 2 + 2 * span, 3 + 3 * span]
if args.leading_first: starts = [page + 1 for page in starts]
cases = [(label, 'center' if args.center else alignment, first) for (label, alignment), first in zip(
    [('inside-odd', 'inside'), ('inside-even', 'inside'), ('outside-even', 'outside'), ('outside-odd', 'outside')], starts)]
for index, (label, alignment, first_page) in enumerate(cases):
    if index in [1, 3]:
        body.append(page_end('Independent parity spacer'))
    if index == 0 and args.leading_first:
        body.append(E.fromstring(paragraph('Body before the first floating table').replace('<w:p>', f'<w:p xmlns:w="{W}">', 1).encode()))
    table = deepcopy(prototype)
    table.find(f'{{{W}}}tblPr/{{{W}}}tblpPr').set(f'{{{W}}}tblpXSpec', alignment)
    table.find(f'{{{W}}}tblPr/{{{W}}}tblpPr').set(f'{{{W}}}horzAnchor', args.horizontal_anchor)
    for side, value in [('left', args.cell_left), ('right', args.cell_right)]:
        table.find(f'{{{W}}}tblPr/{{{W}}}tblCellMar/{{{W}}}{side}').set(f'{{{W}}}w', str(value))
    for row in table.findall(f'{{{W}}}tr')[args.rows:]: table.remove(row)
    for row, text in enumerate(table.findall(f'.//{{{W}}}t')):
        text.text = f'{label} row {row:02}'
    body.append(table)
    body.append(E.fromstring(paragraph(f'{label} anchor after table').replace('<w:p>', f'<w:p xmlns:w="{W}">', 1).encode()))
    if index < len(cases) - 1:
        body.append(page_end(f'{label} section end'))
body.append(E.fromstring(section().replace('<w:sectPr>', f'<w:sectPr xmlns:w="{W}">', 1).encode()))
if args.numbering_restart is not None:
    for properties in document.findall(f'.//{{{W}}}sectPr'):
        node = E.SubElement(properties, f'{{{W}}}pgNumType')
        node.set(f'{{{W}}}start', str(args.numbering_restart))
if args.initial_number is not None:
    properties = document.find(f'.//{{{W}}}sectPr')
    node = properties.find(f'{{{W}}}pgNumType')
    if node is None: node = E.SubElement(properties, f'{{{W}}}pgNumType')
    node.set(f'{{{W}}}start', str(args.initial_number))
if args.mirror_margins:
    for margins in document.findall(f'.//{{{W}}}sectPr/{{{W}}}pgMar'):
        margins.set(f'{{{W}}}left', '1920')
        margins.set(f'{{{W}}}right', '960')
parts['word/document.xml'] = E.tostring(document)
if args.compatibility_mode != 15 or args.mirror_margins:
    settings = E.fromstring(parts['word/settings.xml'])
    setting = settings.find(f'.//{{{W}}}compatSetting[@{{{W}}}name="compatibilityMode"]')
    assert setting is not None
    setting.set(f'{{{W}}}val', str(args.compatibility_mode))
    if args.mirror_margins: settings.insert(0, E.Element(f'{{{W}}}mirrorMargins'))
    parts['word/settings.xml'] = E.tostring(settings)
DEST.mkdir(parents=True, exist_ok=True)
path = DEST / 'control.docx'
with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
    for name, data in parts.items():
        entry = ZipInfo(name, (2026, 10, 10, 0, 0, 0)); entry.compress_type = ZIP_DEFLATED
        archive.writestr(entry, data)
manifest = {'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'rowsPerTable': args.rows,
    'cases': [{'label': label, 'alignment': alignment, 'predictedFirstPage': page, 'predictedLastPage': page + span - 1} for label, alignment, page in cases],
    'prediction': 'Eleven pages; horizontal side follows first fragment parity and stays unchanged on its continuation. Predictions frozen before reference capture; no native ink claim.'}
if variant:
    manifest.update(horizontalAnchor=args.horizontal_anchor, compatibilityMode=args.compatibility_mode)
    if (args.cell_left, args.cell_right, args.rows, args.center) != (108, 108, 18, False):
        manifest.update(cellLeftTwips=args.cell_left, cellRightTwips=args.cell_right,
            prediction=f'{starts[-1] + span} pages; first-fragment alignment is retained on continuation. Frozen before native capture, no ink claim.')
    if args.numbering_restart is not None or args.leading_first:
        manifest.update(numberingRestart=args.numbering_restart, leadingFirst=args.leading_first,
            prediction=f'{starts[-1] + span} pages; horizontal side follows first physical fragment parity even after numbering restarts. Frozen before capture; a counterexample must be retained.')
    if args.initial_number is not None:
        manifest.update(initialNumber=args.initial_number,
            prediction=f'{starts[-1] + span} pages; horizontal side follows physical page ordinal plus initial number minus one, ignoring later numbering restarts. Frozen before capture; retain counterexamples.')
    if args.mirror_margins:
        manifest.update(mirrorMargins=True, pageLeftTwips=1920, pageRightTwips=960,
            prediction=f'{starts[-1] + span} pages; retain first-fragment side, reproject margin anchors with each sheet margin, keep page anchors physically fixed. Frozen before capture; retain counterexamples.')
(DEST / 'cases.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
print(path)
