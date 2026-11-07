"""Native baseline evidence for the original font-size/leading controls."""
import json
import hashlib
from zipfile import ZipFile
from rotated_baseline_scale_fixture import build, FOLDER
from record_rotated_spacing_phase import validate_wrapper
from record_rotated_phase_metafiles import baseline_records
from inspect_emf_text_records import inspect


def record():
    parts, cases = build()
    with ZipFile(FOLDER / 'control.docx') as z:
        if {n: z.read(n) for n in z.namelist()} != parts:
            raise ValueError('Source differs from the controlled construction')
    if json.loads((FOLDER / 'cases.json').read_text()) != cases:
        raise ValueError('Changed cases')
    capture = json.loads((FOLDER / 'capture.json').read_text(encoding='utf-8-sig'))
    if capture != dict(referenceBuild='16.0.20326', tables=48, readOnly=True):
        raise ValueError('Changed capture provenance')
    names, result = ['control.docx', 'cases.json', 'capture.json'], []
    for i, case in enumerate(cases, 1):
        name = f'native-table-{i}.emf'
        names.append(name)
        data = (FOLDER / name).read_bytes()
        validate_wrapper(data)
        labels = [r for r in inspect(data, include_italic=True) if r['text'] == 'a']
        if len(labels) != 12 or any(r['font']['italic'] or r['options'] != 4 or len(r['advances']) != 1 or r['advances'][0] <= 0 or r['scale'] != [4.235294342041016, 4.2272725105285645] for r in labels):
            raise ValueError('Unexpected source glyphs')
        advance = labels[0]['advances'][0]
        scale, rows = baseline_records(data, face=case['font'], height=-round(case['size']/.12), advance=advance)
        if scale != .12:
            raise ValueError('Changed frame mapping')
        result.append(dict(**case, logicalUnitPt=scale, glyphAdvance=advance, rows=rows))
    return dict(referenceBuild=capture['referenceBuild'], hashes={n: hashlib.sha256((FOLDER/n).read_bytes()).hexdigest() for n in names}, cases=result)


if __name__ == '__main__':
    ref = record()
    (FOLDER/'native-reference.json').write_text(json.dumps(ref, indent=2)+'\n')
    print('Recorded 576 original native baselines')
