"""Bind independently authored sources and reference outputs to content hashes."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/empty-inline-controls'
paths = sorted(p for p in OUT.rglob('*') if p.suffix in {'.docx', '.pdf'} and not p.name.startswith('~$'))
paths.append(ROOT / 'tests/fixtures/persistent-block-controls/boundary-matrix/replace-erase-cross-start.docx')
hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
(OUT / 'native/hashes.json').write_text(json.dumps(hashes, indent=2) + '\n', encoding='utf-8')
