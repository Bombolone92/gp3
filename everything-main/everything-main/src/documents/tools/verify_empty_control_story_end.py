"""Verify independently authored inputs and saved native pointer outcomes."""
import hashlib
import json
from zipfile import ZipFile
from lxml import etree as E
from empty_control_story_end_fixture import build, FOLDER, W


def verify():
    for name in ('internal', 'empty'):
        with ZipFile(FOLDER/(name+'.docx')) as z:
            if {n: z.read(n) for n in z.namelist()} != build(name):
                raise ValueError('Changed independently authored source: '+name)
    reference = json.loads((FOLDER/'reference.json').read_text())
    if reference['referenceBuild'] != '16.0.20326' or reference['zoomPercent'] != 500:
        raise ValueError('Review changed native provenance explicitly')
    for case in reference['cases']:
        for kind in ('source', 'result'):
            if hashlib.sha256((FOLDER/case[kind]).read_bytes()).hexdigest() != case[kind+'Sha256']:
                raise ValueError('Changed artifact: '+case[kind])
        with ZipFile(FOLDER/case['result']) as z:
            root = E.fromstring(z.read('word/document.xml'))
        text = '\n'.join(''.join(p.itertext()) for p in root.find(W+'body').findall(W+'p'))
        controls = [dict(text=''.join(c.find(W+'sdtContent').itertext()),
                         placeholder=c.find(W+'sdtPr/'+W+'showingPlcHdr') is not None)
                    for c in root.iter(W+'sdt')]
        if text != case['text'] or controls != case['controls'] or len(controls) != 1:
            raise ValueError('Changed native outcome: '+case['name'])
    return len(reference['cases'])


if __name__ == '__main__':
    print(f'Verified {verify()} native pointer outcomes and source constructions')
