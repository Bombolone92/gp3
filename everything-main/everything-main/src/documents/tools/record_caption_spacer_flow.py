"""Source-bound range-local caption-to-label flow observations."""
from pathlib import Path
import hashlib
import json
from inspect_emf_text_records import inspect
from record_table_prompt_metafiles import label_record

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/caption-spacer-flow'


def record(folder=FOLDER):
    sha = lambda name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
    capture = json.loads((folder / 'native-capture.json').read_text(encoding='utf-8-sig'))
    if capture['sourceSha256'] != sha('control.docx') or capture['sourceUnchanged'] is not True or capture['saved'] is not True:
        raise ValueError('Unbound or modified source')
    if (capture['tables'], capture['controls']) != (6, 0):
        raise ValueError('Unexpected source structure')
    cases = json.loads((folder / 'cases.json').read_text())
    names = ['control.docx', 'cases.json', 'native-capture.json']; observations = []
    if len(cases) != 6 or [c['page'] for c in cases] != list(range(1, 7)):
        raise ValueError('Unexpected source cases')
    for case in cases:
        name = f"native-table-{case['page']}.emf"; names.append(name)
        data = (folder / name).read_bytes()
        top = (60, 886 if case['styled'] and case['spacerBottomNil'] else 882, 375, 4)
        native = label_record(data, top_rectangle=top, left_rectangle=None)
        captions = [r for r in inspect(data, include_italic=True) if r['text'] == 'Caption']
        if len(captions) != 4 or any(r['font'] != dict(height=-100, width=0, escapement=0, orientation=0, weight=900, face='Arial Black', italic=False) for r in captions):
            raise ValueError('Unexpected caption reference fonts')
        if [r['logicalOrigin'] for r in captions] != [[60, y] for y in (225, 366, 507, 648)]:
            raise ValueError('Unexpected caption origins')
        delta = native['logicalOrigin'][1] - captions[-1]['logicalOrigin'][1]
        observations.append(dict(**case, **native, captions=captions, captionToLabelLogical=delta,
                                 captionToLabelPt=delta * native['logicalUnitPtByAxis'][1]))
    return dict(referenceVersion=capture['version'], referenceBuild=capture['build'], method=capture['method'],
                coordinateScope='Difference of two origins in the same detached table range; no page translation inferred',
                hashes={name: sha(name) for name in names}, cases=observations)


if __name__ == '__main__':
    (FOLDER / 'native-reference.json').write_text(json.dumps(record(), indent=2) + '\n')
