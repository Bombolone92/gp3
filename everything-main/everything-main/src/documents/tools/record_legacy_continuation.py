"""Compare native wrapped and standalone glyph advances, independently of the viewer."""
from pathlib import Path
import json,hashlib
from inspect_emf_text_records import inspect
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/legacy-continuation'
rows=[r for r in inspect((folder/'native.emf').read_bytes()) if r['text'].strip()]
prior=[r for r in inspect((root/'tests/fixtures/empty-gpos-kerning/reviewed-family.emf').read_bytes()) if r['text'].strip()]
assert len(rows)==6
pairs=[]
for style,first,second,old in [('regular',1,2,3),('bold',4,5,5)]:
 a,b=rows[first],rows[second];assert a['text']==b['text']==prior[old]['text']
 assert a['logicalOrigin'][0]==b['logicalOrigin'][0]==prior[old]['logicalOrigin'][0]
 assert a['advances']==b['advances']==prior[old]['advances']
 pairs.append(dict(style=style,text=a['text'],wrappedAdvances=a['advances'],standaloneAdvances=b['advances'],font=a['font'],originX=a['logicalOrigin'][0]))
files=['tests/fixtures/legacy-continuation/source.docx','tests/fixtures/legacy-continuation/native.emf','tests/fixtures/empty-gpos-kerning/reviewed-family.emf']
ref=dict(referenceBuild='16.0.20326',hashes={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in files},pairs=pairs,scope='Native EMF logical advances are identical in both contexts and to the earlier reference; does not prove browser or font-version equivalence.')
(folder/'reference.json').write_text(json.dumps(ref,indent=2)+'\n');print('Two native pairs match every advance and the earlier native reference')
