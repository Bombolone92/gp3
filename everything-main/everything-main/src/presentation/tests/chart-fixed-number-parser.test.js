import { describe, expect, it } from "vitest";
import { formatFixedChartNumber } from "../lib/pptx-preview/src/chart-number-format.ts";

describe("fixed chart number format operators", () => {
  it.each([
    ["00000", 12, "00012"],
    ["0,000", -12, "-0,012"],
    ["#,##0,,.00", 12345678, "12.35"],
    ["#,##0.00,,", -12345678, "-12.35"],
    ["#,##0.00%", 123.456, "12,345.60%"],
    ['0.00"%"', 123.456, "123.46%"],
    ["0.00\\%", 123.456, "123.46%"],
    ['"x""y"0.00" z"', -12, "-xy12.00 z"],
    ["\\$0.00", -12345.6, "-$12345.60"],
    ['"\\$"0.00', 12345.6, "$12345.60"],
    ["0.00", -0, "0.00"],
    ["0.##", 12345.6, "12345.6"],
  ])("formats %s at %s as %s", (format, value, expected) => {
    expect(formatFixedChartNumber(value, format)).toBe(expected);
  });

  it.each([
    "General",
    "m/d/yyyy",
    "0.00E+00",
    "0;[Red]-0",
    "[>=100]0",
    '"unfinished',
    "0.00\\",
    "0.0.0",
  ])(
    "leaves other or incomplete format families to the existing fallback: %s",
    (format) => {
      expect(formatFixedChartNumber(12345.6, format)).toBeUndefined();
    },
  );
});
