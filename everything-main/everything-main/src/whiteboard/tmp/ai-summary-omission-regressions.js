const summaryScopeNotice = {
  en: "Some source text was shortened or left out to fit the summary limit. Check the original content before using this summary.",
  fr: "Une partie du texte source a été raccourcie ou omise pour respecter la limite du résumé. Vérifiez le contenu original avant d’utiliser ce résumé.",
};
const summaryScopeCases = [
  ["short content", false],
  ["exact object limit", false],
  ["over object limit", true],
  ["Unicode object cutoff", true],
  ["exact combined limit", false],
  ["over combined limit", true],
  ["exact limit with blank remainder", false],
  ["exact limit with later content", true],
  ["private excess content", false],
  ["late selected content", false],
];
function summaryScopeItems(kind) {
  if (kind === "short content") return [item("note", 0, 0, { text: "Visible decision." })];
  if (kind === "exact object limit") return [item("text", 0, 0, { text: "A".repeat(2000) })];
  if (kind === "over object limit") return [item("text", 0, 0, { text: "A".repeat(2000) + "Decision: keep the launch date." })];
  if (kind === "Unicode object cutoff") return [item("text", 0, 0, { text: "A".repeat(1999) + "😀" })];
  const items = Array.from({ length: 25 }, (_, n) => item("note", n, 0, {
    text: "A".repeat(n === 24 ? (kind === "over combined limit" ? 1992 : 1991) : 1990),
  }));
  if (kind === "exact limit with blank remainder") items.push(item("note", 0, 1, { text: " \n " }));
  if (["exact limit with later content", "private excess content", "late selected content"].includes(kind)) items.push(item("note", 0, 1, { text: "Decision: keep the launch date." }));
  return items;
}
for (const locale of ["en", "fr"]) for (const [kind, shortened] of summaryScopeCases)
  test(`summary review explains only actual source omissions: ${kind} in ${locale}`, async () => {
    const a = setup("Reviewed summary.");
    try {
      setLanguage(locale);
      a.b.items = summaryScopeItems(kind);
      const shown = kind === "private excess content" ? [a.b.items.at(-1)] : a.b.items;
      const chosen = kind === "late selected content" ? [a.b.items.at(-1)] : [];
      a.show(shown.map(i => i.id));
      a.choose(chosen.map(i => i.id));
      shown[0].lang = "fr-CA";
      shown[0].textRuns = [{ start: 0, end: 1, style: { lang: "en-GB" } }];
      validateBoard(structuredClone(a.b));
      const source = JSON.stringify(a.b);
      await a.ai.summarize(a.d);
      const sent = a.prompts[0].prompt.split("\n\nContent:\n")[1];
      assert.equal(sent, boardText(shown, chosen.length ? new Set(chosen.map(i => i.id)) : null));
      assert.equal(sent.isWellFormed(), true);
      if (kind.includes("combined") || kind.startsWith("exact limit")) assert.equal(sent.length, 50000);
      assert.deepEqual(fieldContent(a.input), { text: "Reviewed summary.", lang: locale });
      const notice = a.d.querySelector("#ai-summary-scope");
      if (shortened) {
        assert.ok(notice, "The review must identify source text that was shortened or left out.");
        assert.equal(notice.textContent, summaryScopeNotice[locale]);
        assert.equal(notice.hidden, false);
        assert.ok(a.input.getAttribute("aria-describedby")?.split(/\s+/).includes(notice.id));
      } else {
        assert.equal(notice, null);
        assert.ok(!a.input.getAttribute("aria-describedby")?.split(/\s+/).includes("ai-summary-scope"));
      }
      await a.d.querySelector("#ai-copy").onclick();
      assert.equal(await a.copied[0].data["text/plain"].text(), "Reviewed summary.");
      assert.equal(a.d.querySelector("#ai-summary-scope"), notice);
      assert.equal(JSON.stringify(a.b), source);
      assert.equal(a.writes(), 0);
    } finally {
      a.close();
    }
  });

for (const locale of ["en", "fr"])
  test(`summary omission notice clears when a complete request replaces the review in ${locale}`, async () => {
    const a = setup("Reviewed summary.");
    try {
      setLanguage(locale);
      a.b.items = summaryScopeItems("over object limit");
      a.show(a.b.items.map(i => i.id));
      await a.ai.summarize(a.d);
      assert.equal(a.d.querySelector("#ai-summary-scope")?.textContent, summaryScopeNotice[locale]);
      a.b.items[0].text = "Complete source.";
      const source = JSON.stringify(a.b);
      await a.ai.summarize(a.d);
      assert.equal(a.prompts.length, 2);
      assert.equal(a.d.querySelector("#ai-summary-scope"), null);
      assert.ok(!a.input.getAttribute("aria-describedby")?.includes("ai-summary-scope"));
      assert.equal(JSON.stringify(a.b), source);
      assert.equal(a.writes(), 0);
    } finally {
      a.close();
    }
  });
