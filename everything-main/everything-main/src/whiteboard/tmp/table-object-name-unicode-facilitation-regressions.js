
for(const locale of ['en','fr'])
  test(`long table vote labels retain translated prefix and exact captured cell languages in ${locale}`,()=>{
    const table=item('table',0,0,{id:'a',cells:[['Intro','Q'.repeat(291)+'😀']],lang:'de',cellLanguages:{'0,1':{lang:'fr-CA',textRuns:[{start:291,end:293,style:{lang:'en-GB'}}]}}});
    const original=structuredClone(table),b={...newBoard('Long table votes'),items:[table],workshop:Object.fromEntries([['vote',vote({targets:['a'],hidden:false})],ballot(owner,['a'])])};
    validateBoard(b);const ui=stubUI(b,{role:'owner',me:owner}),previous=language;
    try {
      setLanguage(locale);const prefix=locale==='en'?'Table: ':'tableau de données: ',expected=prefix+'Intro · '+'Q'.repeat(120-prefix.length-8);
      ui.api.open('vote');const preview=ui.doc.querySelector('.fac-vote-list li');assert.ok(preview.textContent.includes(expected));
      ui.click('[data-fac="vote-end"]');const result=Object.values(b.workshop).find(r=>r.results).results[0];
      assert.equal(result.label,expected);assert.equal(result.lang,locale);
      assert.deepEqual(result.textRuns,[{start:prefix.length,end:prefix.length+8,style:{lang:'de'}},{start:prefix.length+8,end:120,style:{lang:'fr-CA'}}]);
      validateBoard(b);assert.deepEqual(table,original);
    }finally{setLanguage(previous);ui.close();}
  });
