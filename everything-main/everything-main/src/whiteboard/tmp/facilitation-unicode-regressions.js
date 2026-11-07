for (const length of [118,119,120]) {
  test(`voting previews retain complete Unicode at ${length} characters`, () => {
    const n=notes();n[0].text="Q".repeat(length)+"😀";n[0].lang="fr-CA";
    const b={...newBoard("Unicode votes"),items:n,workshop:Object.fromEntries([["vote",vote({targets:["a"],hidden:false})],ballot(owner,["a"])])};
    validateBoard(b);
    const ui=stubUI(b,{role:"owner",me:owner});
    try {
      ui.api.open("vote");
      const caption=ui.doc.querySelector('.fac-vote-list [data-user-content]');
      assert.equal(caption.textContent.isWellFormed(),true);
      assert.equal(caption.lang,"fr-CA");
      assert.equal(n[0].text,"Q".repeat(length)+"😀");
    }finally{ui.close();}
  });
  test(`completed votes retain complete Unicode at ${length} characters`, () => {
    const n=notes();n[0].text="Q".repeat(length)+"😀";n[0].lang="fr-CA";
    const b={...newBoard("Unicode votes"),items:n,workshop:Object.fromEntries([["vote",vote({targets:["a"],hidden:false})],ballot(owner,["a"])])};
    validateBoard(b);
    const ui=stubUI(b,{role:"owner",me:owner});
    try {
      ui.api.open("vote");ui.click('[data-fac="vote-end"]');
      const record=Object.values(b.workshop).find(r=>r.results),result=record.results[0];
      assert.equal(result.label.isWellFormed(),true);
      validateBoard(b);
      assert.equal(n[0].text,"Q".repeat(length)+"😀");
    }finally{ui.close();}
  });
}
