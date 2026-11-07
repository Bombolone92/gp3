"""Original script-size controls crossing low and high OS/2 offset thresholds."""
from pathlib import Path
import argparse
from script_vdmx_ppem_fixture import write_controls
from script_position_metrics_fixture import build

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT/'tests/fixtures/script-size-offset'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=TARGET)
    target = parser.parse_args().output
    target.mkdir(parents=True, exist_ok=True)
    fonts, cases = [], []
    for size in [650, 850]:
        for offset in [0, 200, 250, 350, 450, 500, 550, 600, 650, 700, 750]:
            family = f'Script Offset {size} {offset}'
            path = build(family, {'OS/2': {20: size, 24: offset}}, target)
            fonts.append(path.name)
            cases.append(dict(family=family, sizeMetric=size, offsetMetric=offset,
                              rows=[dict(size=20, script=s) for s in ['superscript', 'subscript']]))
    write_controls(target, cases, fonts)
    print('Authored 22 sizing-threshold fonts and 44 native script rows')


if __name__ == '__main__': main()
