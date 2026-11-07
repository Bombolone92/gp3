"""Source-bound table-context controls; detached native ranges, not page origins."""
from pathlib import Path
import hashlib
import json
from record_table_prompt_metafiles import label_record

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/table-label-context'


def record(folder=FOLDER):
    sha = lambda name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
    metadata = json.loads((folder / 'native-capture.json').read_text(encoding='utf-8-sig'))
    if metadata['sourceSha256'] != sha('control.docx') or metadata['sourceUnchanged'] is not True or metadata['saved'] is not True:
        raise ValueError('Unbound or changed source')
    if metadata['tables'] != 6 or metadata['controls'] != 0:
        raise ValueError('Unexpected source structure')
    cases = json.loads((folder / 'cases.json').read_text())
    if len(cases) != 6 or [c['page'] for c in cases] != list(range(1, 7)):
        raise ValueError('Unexpected context cases')
    names = ['control.docx', 'cases.json', 'native-capture.json']
    observations = []
    for case in cases:
        name = f"native-table-{case['page']}.emf"
        names.append(name)
        # Each expected rectangle follows the independent control's first-cell
        # border layout. The recorder verifies its presence in native ink.
        top = (60, 148, 375, 4) if case['nested'] else (0, 0, 375, 4) if case['styled'] else (4, 0, 371, 4)
        left = None if case['styled'] else (0, 4, 4, 327 if case['height'] == 'exact' else 331)
        native = label_record((folder / name).read_bytes(), top_rectangle=top, left_rectangle=left)
        baseline = native['logicalOrigin'][1] - native['firstCellBorderCenter'][1]
        observations.append(dict(**case, **native, baselineFromTopBorderLogical=baseline,
                                 baselineFromTopBorderPt=baseline * native['logicalUnitPtByAxis'][1]))
    return dict(referenceVersion=metadata['version'], referenceBuild=metadata['build'],
                coordinateScope='Detached table range; physical-frame rounding, no page translation inferred',
                hashes={name: sha(name) for name in names}, cases=observations)


if __name__ == '__main__':
    (FOLDER / 'native-reference.json').write_text(json.dumps(record(), indent=2) + '\n', encoding='utf-8')
    print('Recorded six source-bound table-context observations')
