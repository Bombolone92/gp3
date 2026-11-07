"""Original controls isolating subscript offsets and script-size validation."""
from pathlib import Path
import argparse
from script_vdmx_ppem_fixture import write_controls
from script_position_metrics_fixture import build

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT/'tests/fixtures/script-sub-offset'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=TARGET)
    target = parser.parse_args().output
    target.mkdir(parents=True, exist_ok=True)
    cases, fonts = [], []
    for size in [650, 850]:
        for offset in [0, 75, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800]:
            family = f'Script Sub Offset {size} {offset}'
            path = build(family, {'OS/2': {16: offset, 20: size, 24: 350}}, target)
            fonts.append(path.name)
            cases.append(dict(family=family, sizeMetric=size, subOffsetMetric=offset,
                              rows=[dict(size=20, script=s) for s in ['superscript', 'subscript']]))
    write_controls(target, cases, fonts)
    print('Authored 28 isolated subscript-offset fonts and 56 native rows')

if __name__ == '__main__': main()
