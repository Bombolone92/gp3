// Native palette class counts and independent full/half/background phase probes.
export const halftonePatternCases = [
  [
    "dnDiag",
    8,
    16,
    [[0, 0]],
    [
      [1, 0],
      [7, 0],
    ],
    [[2, 0]],
  ],
  [
    "upDiag",
    8,
    16,
    [[7, 0]],
    [
      [0, 0],
      [6, 0],
    ],
    [[5, 0]],
  ],
  [
    "diagCross",
    16,
    24,
    [
      [3, 3],
      [4, 3],
    ],
    [
      [2, 3],
      [5, 3],
    ],
    [[0, 3]],
  ],
];
