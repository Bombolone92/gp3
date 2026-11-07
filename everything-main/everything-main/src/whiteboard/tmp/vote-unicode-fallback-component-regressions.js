for (const locale of ['en','fr'])
  for (const type of ['image','file','table'])
    test(`voting captured ${type} names preserve the boundary and authored body language in ${locale}`,()=>{
      const previous=language;
      const target=item(type,0,0,{id:'a',text:'',lang:'fr-CA',...(type==='image'?{src:createCanvas(2,2).toDataURL()}:type==='file'?{data:'data:application/octet-stream;base64,eA==',fileName:''}:{cells:[['']]})});
      const b={...newBoard('Alternative vote labels'),items:[target],workshop:Object.fromEntries([['vote',vote({targets:['a'],hidden:false})],ballot(owner,['a'])])};
      const ui=stubUI(b,{role:'owner',me:owner});
      try{
        setLanguage(locale);
        const prefix=objectKind(target)+': ',short='Q'.repeat(119-prefix.length),body=short+'😀',expected=prefix+short;
        if(type==='image')target.alt=body;
        else if(type==='file')target.fileName=body;
        else target.cells=[[body]];
        const original=structuredClone(target);
        validateBoard(b);ui.api.open('vote');
        const caption=ui.doc.querySelector('.fac-vote-list [data-user-content]');
        assert.equal(caption.textContent,short);
        assert.equal(caption.lang,'fr-CA');
        ui.click('[data-fac="vote-end"]');
        const result=Object.values(b.workshop).find(r=>r.results).results[0];
        assert.equal(result.label,expected);
        assert.equal(result.label.isWellFormed(),true);
        assert.equal(result.lang,locale);
        assert.deepEqual(result.textRuns,[{start:prefix.length,end:119,style:{lang:'fr-CA'}}]);
        validateBoard(b);assert.deepEqual(target,original);
      }finally{setLanguage(previous);ui.close();}
    });
