"""Build original row-geometry fixtures with standard-library OPC/XML only.

Generators execute in a temporary directory so their intermediate packages never
modify the repository. Native reference measurements are separately recorded data;
this builder does not derive expectations from the document engine.
"""
from pathlib import Path
import runpy
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GENERATORS = [
    'row-padding', 'row-merge-padding', 'row-mixed-border', 'row-exact-border',
    'row-border-width', 'row-column-border', 'row-page-edge', 'row-auto-page-edge',
    'row-repeated-header', 'row-clipping-border', 'row-oversized',
    'row-oversized-short', 'row-oversized-headers', 'row-header-clearance',
    'row-merged-oversized', 'row-merged-later', 'row-merged-exact', 'row-header-threshold',
]
FIXTURES = GENERATORS[:11] + [
    'row-oversized-modern', 'row-oversized-short-modern',
    'row-oversized-headers-14', 'row-oversized-headers-15', 'row-header-clearance',
    'row-merged-oversized-14', 'row-merged-oversized-15', 'row-merged-later-15',
    'row-merged-later-14', 'row-merged-exact-oversized-14', 'row-merged-exact-oversized-15', 'row-merged-exact-later-14', 'row-merged-exact-later-15',
    'row-header-threshold-14', 'row-header-threshold-15',
]


def generate():
    destination = ROOT / 'public/fixtures/row-geometry'
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='documents-row-geometry-') as directory:
        temporary = Path(directory)
        for name in GENERATORS:
            shutil.copyfile(ROOT / 'tools/row_geometry' / f'{name}-probe.py', temporary / f'{name}-probe.py')
        for name in GENERATORS:
            runpy.run_path(str(temporary / f'{name}-probe.py'), run_name='__main__')
        for name in FIXTURES:
            target = destination / f'{name}-probe.docx'
            shutil.copyfile(temporary / target.name, target)
            print(target)


if __name__ == '__main__':
    generate()
