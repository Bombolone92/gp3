import test from "node:test";
import assert from "node:assert/strict";
import { canonicalLanguage } from "../src/accessibility/language-tag.js";

test("language normalization respects the stored length limit and stays stable on revalidation", () => {
  const overflow =
    "sh-x-a1234567-b1234567-c1234567-d1234567-e1234567-f1234567-g123";
  assert.equal(overflow.length, 63);
  assert.equal(Intl.getCanonicalLocales(overflow)[0].length, 68);
  assert.equal(canonicalLanguage(overflow), null);
  const boundary =
    "en-x-a1234567-b1234567-c1234567-d1234567-e1234567-f1234567-g1234";
  assert.equal(boundary.length, 64);
  assert.equal(canonicalLanguage(boundary), boundary);
  assert.equal(canonicalLanguage(boundary + "5"), null);
  for (const [input, expected] of [
    ["sh", "sr-Latn"],
    ["iw", "he"],
    ["fr-ca", "fr-CA"],
    [boundary, boundary],
  ]) {
    assert.equal(canonicalLanguage(input), expected);
    assert.equal(canonicalLanguage(canonicalLanguage(input)), expected);
  }
});
