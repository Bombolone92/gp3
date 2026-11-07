"""Isolate compatibility mode in the original manually authored script controls."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from record_script_position_metafiles import capture

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'tests/fixtures/script-size'
TARGET = ROOT / 'tests/fixtures/script-position-compatibility'


def parts(path):
    with ZipFile(path) as package:
        return {name: package.read(name) for name in package.namelist()}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generate', action='store_true')
    args = parser.parse_args()
    original = parts(SOURCE / 'control.docx')
    assert original['word/settings.xml'].count(b'w:val="15"') == 1
    expected = {}
    for mode in [12, 15]:
        expected[mode] = dict(original)
        expected[mode]['word/settings.xml'] = original['word/settings.xml'].replace(
            b'w:val="15"', f'w:val="{mode}"'.encode())
    if args.generate:
        TARGET.mkdir(exist_ok=True)
        for mode in [12, 15]:
            with ZipFile(TARGET / f'mode-{mode}.docx', 'w', ZIP_DEFLATED) as package:
                for name, data in expected[mode].items():
                    package.writestr(name, data)
        print('Generated two inputs differing only in the compatibility setting')
        return
    reference = json.loads((SOURCE / 'reference.json').read_text())
    assert sha(SOURCE / 'control.docx') == reference['sourceSha256']
    assert sha(SOURCE / 'native.pdf') == reference['pdfSha256']
    cases = json.loads((SOURCE / 'cases.json').read_text())
    assert len(cases) == 9 and len(reference['cases']) == 9
    results, names, differences = [], [], []
    for mode in [12, 15]:
        name = f'mode-{mode}.docx'
        assert parts(TARGET / name) == expected[mode]
        names.append(name)
        for index, (case, previous) in enumerate(zip(cases, reference['cases']), 1):
            assert case['family'] == previous['family'] and case['face'] == previous['face']
            assert len(case['rows']) == len(previous['rows']) == 12
            name = f'mode-{mode}-font-{index}.emf'
            measured, _ = capture((TARGET / name).read_bytes(), case)
            names.append(name)
            for actual, pdf in zip(measured['rows'], previous['rows']):
                assert (actual['size'], actual['script']) == (pdf['size'], pdf['script'])
                difference = abs(actual['risePt'] - pdf['rise'])
                # PDF coordinates have decimal serialization rounding; mode
                # comparisons below use the exact integral EMF coordinates.
                assert difference <= .021
                differences.append(difference)
            results.append(dict(mode=mode, family=case['family'], face=case['face'], **measured))
    for left, right in zip(results[:9], results[9:]):
        assert left['rows'] == right['rows']
    output = dict(referenceBuild='16.0.20326', modes=[12, 15],
                  sourceHashes={n: sha(SOURCE / n) for n in ['control.docx', 'cases.json', 'native.pdf', 'reference.json']},
                  hashes={n: sha(TARGET / n) for n in names},
                  maximumPdfDifferencePt=max(differences), cases=results)
    (TARGET / 'reference.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
    print('Verified 216 native positions, 108 identical mode pairs, and exact source-part isolation')
    print('Maximum PDF serialization difference:', max(differences))


if __name__ == '__main__':
    main()
