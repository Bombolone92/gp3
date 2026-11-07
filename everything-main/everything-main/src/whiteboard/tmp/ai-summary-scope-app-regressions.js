for(const locale of ['en','fr'])
test(`selected summary keeps its displayed scope after a collaborator deletes the selection in ${locale}`,async()=>{
 const chosen=item('note',0,0,{text:'Chosen short source.'}),other=item('note',300,0,{text:'Other visible notes that were not chosen.'}),room='selected-summary-scope-'+locale;
 const shared=await sharedEditors(room,[chosen,other]);
 try{
  const [a,b]=shared.apps,requests=[];
  b.w.puter.ai={chat:async(...args)=>{requests.push(args);return 'Controlled summary.';}};
  b.doc.querySelector('#language').value=locale;
  b.doc.querySelector('#language').dispatchEvent(new b.w.Event('change'));
  await b.tick();
  await b.click(`#board-outline [data-id="${chosen.id}"]`);
  await b.click('[data-action="ai"]');
  const dialog=b.doc.querySelector('dialog[open]'),button=dialog.querySelector('[data-ai="summarize"]'),label=locale==='fr'?'Les objets sélectionnés':'The selected objects';
  assert.equal(button.querySelector('small').textContent,label);
  await a.click(`#board-outline [data-id="${chosen.id}"]`);
  await a.click('[data-action="delete"]');
  await shared.until(()=>!b.doc.querySelector(`#board-outline [data-id="${chosen.id}"]`),'Remote deletion reached the actual editor while the AI dialog stayed open.');
  assert.equal(dialog.open,true);
  assert.equal(button.querySelector('small').textContent,label);
  const source=(await storedSharedBoard(b,room)).items;
  assert.equal(source.length,1);
  assert.equal(source[0].text,other.text);
  await b.click('[data-ai="summarize"]');
  assert.equal(requests.length,0,'A selected-object action must not send the other board content when its selected source disappears.');
  assert.equal(dialog.querySelector('#ai-summary'),null);
  assert.deepEqual((await storedSharedBoard(b,room)).items,source);
 }finally{await shared.close();}
});
