"""Original multi-size controls isolating the upper subscript-offset boundary."""
from pathlib import Path
import argparse
from script_vdmx_ppem_fixture import write_controls
from script_position_metrics_fixture import build

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT/'tests/fixtures/script-sub-offset-threshold'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=TARGET)
    target = parser.parse_args().output
    target.mkdir(parents=True, exist_ok=True)
    cases, fonts = [], []
    for offset in [500, 501, 510, 520, 524, 525, 526, 550]:
        family = f'Script Sub Threshold {offset}'
        path = build(family, {'OS/2': {12: 500, 16: offset, 20: 650, 24: 350}}, target)
        fonts.append(path.name)
        cases.append(dict(family=family, sizeMetric=650, subOffsetMetric=offset,
                          rows=[dict(size=size, script=s) for size in [8, 8.5, 10, 10.5, 12, 12.5, 20, 20.5]
                                for s in ['superscript', 'subscript']]))
    write_controls(target, cases, fonts)
    print('Authored eight upper-bound fonts and 128 native rows')

if __name__ == '__main__': main()
