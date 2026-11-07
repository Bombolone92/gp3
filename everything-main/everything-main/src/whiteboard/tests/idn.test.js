import test from "node:test";
import assert from "node:assert/strict";
import { domainToUnicode } from "node:url";
import { toUnicode } from "../src/idn.js";

test("punycode host names read as their owners write them", () => {
  for (const host of [
    "xn--mnchen-3ya.de",
    "xn--r8jz45g.jp",
    "xn--80ak6aa92e.com",
    "xn--nxasmq6b.gr",
    "xn--mgbh0fb.xn--kgbechtv",
    "shop.xn--caf-dma.com",
    "xn--ls8h.la",
    "example.com",
    "XN--MNCHEN-3YA.de",
  ])
    assert.equal(toUnicode(host), domainToUnicode(host), host);
  // A label that is not punycode stays as it is, as the address holds it.
  assert.equal(toUnicode("xn--.example"), "xn--.example");
  assert.equal(toUnicode("xn--zzz!.example"), "xn--zzz!.example");
});
