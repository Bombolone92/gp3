
for(const n of [298,299,300])
  test(`table destination previews retain complete Unicode at ${n} characters`,()=>{
    const a=setup();
    try {
      const text='Q'.repeat(n)+'😀',target=item('table',300,0,{cells:[[text]],lang:'fr-CA'}),source=item('note',0,0,{text:'Source',objectLink:{objectId:target.id}});
      a.s.board.items=[source,target];a.s.selected=source;a.ui.show();
      const caption=a.doc.querySelector('#object-link-current a');assert.ok(caption);assert.equal(caption.textContent.isWellFormed(),true);assert.equal(target.cells[0][0],text);
    }finally{a.close();}
  });
