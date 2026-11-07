"""Source-bound native controls for empty paragraphs preceding nested tables."""
from pathlib import Path
import hashlib
import json
from inspect_emf_text_records import inspect
from record_table_prompt_metafiles import label_record

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures'


def record(folder):
    sha = lambda name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
    capture = json.loads((folder / 'native-capture.json').read_text(encoding='utf-8-sig'))
    if capture['sourceSha256'] != sha('control.docx') or capture['sourceUnchanged'] is not True or capture['saved'] is not True:
        raise ValueError('Unbound or modified source')
    if (capture['tables'], capture['controls']) != (6, 0):
        raise ValueError('Unexpected source structure')
    cases = json.loads((folder / 'cases.json').read_text())
    if len(cases) != 6 or [c['page'] for c in cases] != list(range(1, 7)):
        raise ValueError('Unexpected control cases')
    names = ['control.docx', 'cases.json', 'native-capture.json']; observations = []
    for case in cases:
        name = f"native-table-{case['page']}.emf"; names.append(name)
        data = (folder / name).read_bytes()
        top = (60, 164 if case['latinSize'] == 10.5 else 160, 375, 4)
        native = label_record(data, top_rectangle=top, left_rectangle=None)
        prefix = inspect(data, include_italic=True)[0]
        expected_text = case.get('text') or ' '
        expected_height = -88 if case['latinSize'] == 10.5 else -83
        if prefix['text'] != expected_text or prefix['logicalOrigin'][0] != 60 or prefix['font'] != dict(
            height=expected_height, width=0, escapement=0, orientation=0, weight=400, face='Arial', italic=False
        ):
            raise ValueError('Unexpected paragraph prefix')
        observations.append(dict(**case, **native, prefix=prefix,
                                 baselineFromTopBorderLogical=native['logicalOrigin'][1] - native['firstCellBorderCenter'][1]))
    return dict(referenceVersion=capture['version'], referenceBuild=capture['build'], method=capture['method'],
                coordinateScope='Detached table ranges; no physical page translation inferred',
                hashes={name: sha(name) for name in names}, cases=observations)


if __name__ == '__main__':
    for name in ('empty-paragraph-script-size', 'empty-paragraph-spacing'):
        folder = ROOT / name
        (folder / 'native-reference.json').write_text(json.dumps(record(folder), indent=2) + '\n')
        print('Recorded ' + name)
