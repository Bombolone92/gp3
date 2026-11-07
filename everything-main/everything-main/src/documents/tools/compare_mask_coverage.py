"""Measure alpha-mask multiplication against an independent native raster."""
import argparse
import json
from hashlib import sha256
from pathlib import Path
import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mask', type=Path)
    parser.add_argument('coverage', type=Path)
    parser.add_argument('reference', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    arrays, hashes = [], {}
    for name in ['mask', 'coverage', 'reference']:
        path = getattr(args, name)
        hashes[name] = sha256(path.read_bytes()).hexdigest()
        with Image.open(path) as image:
            if 'A' not in image.getbands():
                raise ValueError(f'{name} must have an alpha channel')
            arrays.append(np.array(image.getchannel('A')).astype(np.float64))
    mask, coverage, reference = arrays
    if not mask.shape == coverage.shape == reference.shape:
        raise ValueError('All three rasters must use identical pixel coordinates')
    actual = np.floor(mask * coverage / 255 + .5)
    error = abs(actual - reference)
    result = dict(operation='round(maskAlpha * coverageAlpha / 255)',
                  width=mask.shape[1], height=mask.shape[0], sha256=hashes,
                  changedPixels=int(np.count_nonzero(error)),
                  maxError=int(error.max()), totalError=int(error.sum()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 1 if result['changedPixels'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
