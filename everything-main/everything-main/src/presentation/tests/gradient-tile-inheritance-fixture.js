import { patternInheritanceDeck } from "./pattern-inheritance-fixture.js";

const stops =
  '<a:gsLst><a:gs pos="0"><a:srgbClr val="000000"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst>';
const gradient = (tile = "", complete = false) =>
  `<a:gradFill>${complete ? `${stops}<a:lin ang="0" scaled="0"/>` : ""}${tile}</a:gradFill>`;
const tile = (l, r) => `<a:tileRect l="${l}" r="${r}"/>`;
const own = gradient("", true),
  layout = gradient(tile(25000, 35000));
export const gradientTileInheritanceCases = [
  {
    name: "complete linear fill still inherits master tile",
    own,
    expected: { left: 0.1, right: 0.2 },
  },
  {
    name: "complete linear fill still inherits own style tile",
    own,
    ownStyle: 1,
    expected: { left: 0.3, right: 0.1 },
  },
  {
    name: "own empty tile resets style and master",
    own: gradient("<a:tileRect/>", true),
    ownStyle: 1,
    expected: undefined,
  },
  {
    name: "own zero edge resets the complete tile",
    own: gradient('<a:tileRect l="0"/>', true),
    ownStyle: 1,
    expected: undefined,
  },
  {
    name: "complete linear fill inherits layout tile",
    own,
    layout,
    expected: { left: 0.25, right: 0.35 },
  },
  {
    name: "own zero style permits layout tile",
    own,
    ownStyle: 0,
    layout,
    expected: { left: 0.25, right: 0.35 },
  },
  {
    name: "layout solid blocks master tile",
    own,
    layout: '<a:solidFill><a:srgbClr val="1267A8"/></a:solidFill>',
    expected: undefined,
  },
  {
    name: "layout empty tile resets master tile",
    own,
    layout: gradient("<a:tileRect/>"),
    expected: undefined,
  },
];
export const gradientTileInheritanceDeck = (
  cases = gradientTileInheritanceCases,
) =>
  patternInheritanceDeck(cases, {
    masterFill: gradient(tile(10000, 20000)),
    fillStyles: `${gradient(tile(30000, 10000), true)}<a:noFill/><a:noFill/>`,
  });
