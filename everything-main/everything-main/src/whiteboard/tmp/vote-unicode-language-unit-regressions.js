
for (const locale of ['en','fr'])
  for (const length of [118,119,120])
    test(`voting Unicode labels preserve exact whole and passage languages in ${locale} at ${length}`,()=>{
      const previous=language;
      const n=notes(),text='Q'.repeat(length)+'😀',expected=length===118?text:'Q'.repeat(Math.min(length,120));
      n[0].text=text;n[0].lang='fr-CA';n[0].textRuns=[{start:length,end:length+2,style:{lang:'en-GB'}}];
      const original=structuredClone(n);
      const b={...newBoard('Unicode votes'),items:n,workshop:Object.fromEntries([['vote',vote({targets:['a'],hidden:false})],ballot(owner,['a'])])};
      validateBoard(b);const ui=stubUI(b,{role:'owner',me:owner});
      try {
        setLanguage(locale);ui.api.open('vote');const caption=ui.doc.querySelector('.fac-vote-list [data-user-content]');
        assert.equal(caption.textContent,expected);assert.equal(caption.lang,'fr-CA');
        assert.equal(caption.querySelector('[lang="en-GB"]')?.textContent,length===118?'😀':undefined);
        ui.click('[data-fac="vote-end"]');const record=Object.values(b.workshop).find(r=>r.results),result=record.results[0];
        assert.equal(result.label,expected);assert.equal(result.lang,'fr-CA');
        assert.deepEqual(result.textRuns,length===118?[{start:118,end:120,style:{lang:'en-GB'}}]:undefined);
        validateBoard(b);assert.deepEqual(n,original);
      }finally{setLanguage(previous);ui.close();}
    });
