"""Bind independent synthetic-bold controls and reference capture artifacts."""
from pathlib import Path
import hashlib
import json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/synthetic-bold-advance'
hashes={}
for name in ['modern','thousand','ligatures']:
    for suffix in ['.docx','-cases.json','-native.json','-native.pdf']:
        file=folder/(name+suffix)
        hashes[file.name]=hashlib.sha256(file.read_bytes()).hexdigest()
    native=json.loads((folder/(name+'-native.json')).read_text(encoding='utf-8-sig'))
    assert native['sourceSha256']==hashes[name+'.docx']
    assert len(native['cases'])==len(json.loads((folder/(name+'-cases.json')).read_text()))
for name in ['weights-cases.json','weights-native.json','weights-native.pdf','../synthetic-bold/weights.docx']:
    hashes[name]=hashlib.sha256((folder/name).read_bytes()).hexdigest()
assert json.loads((folder/'weights-native.json').read_text(encoding='utf-8-sig'))['sourceSha256']==hashes['../synthetic-bold/weights.docx']
(folder/'hashes.json').write_text(json.dumps(hashes,indent=2)+'\n',encoding='utf8')
