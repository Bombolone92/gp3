from pathlib import Path
import json,hashlib
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/diagram-order-normalization'
(folder/'hashes.json').write_text(json.dumps({name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in ['control.docx','native.docx','native.pdf','control-nonzero.docx','native-nonzero.docx','native-nonzero.pdf']},indent=2)+'\n',encoding='utf-8')
