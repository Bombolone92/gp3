const unicodeSearchCases = [
  ...[178,179,180].map(n=>({name:`end ${n}`,text:"Q".repeat(n)+"😀",query:"Q"})),
  ...[48,49,50].map(n=>({name:`start ${n}`,text:"😀"+"X".repeat(n)+"Q",query:"Q"})),
];
for(const example of unicodeSearchCases)
  test(`board search excerpts retain complete Unicode at ${example.name}`, () => {
    const entries=createSearchIndex([item("note",0,0,{text:example.text})]);
    const matches=searchIndex(entries,example.query);
    assert.equal(matches.length,1);
    const excerpt=searchExcerpt(matches[0],example.query);
    assert.ok(excerpt.includes(example.query));
    assert.equal(excerpt.isWellFormed(),true);
    assert.equal(matches[0].item.text,example.text);
  });
