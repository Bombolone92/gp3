import {it,expect} from 'vitest';
import {bookmarkEntries,replaceBookmarkMarkers,bookmarkInlineEvents} from '../src/engine/bookmarks.js';
const p=(id,text,bookmarks)=>({id,runs:[{text}],...(bookmarks?{bookmarks}:{})});
function paragraphs(){return [p('a','Alpha',[{id:'7',edge:'start',name:'Whole',offset:0,order:0,blockBoundary:'before'}]),p('b','Beta',[{id:'7',edge:'end',offset:5,order:1,blockBoundary:'after'}]),p('c','After')];}
it('includes the final paragraph break in a block bookmark',()=>{
  const ps=paragraphs();expect(bookmarkEntries(ps)[0]).toMatchObject({start:0,end:11});
  expect(bookmarkInlineEvents(ps[1]).some(event=>event.marker)).toBe(false);
});
it('keeps the after-paragraph boundary through insertion and paragraph splitting',()=>{
  const old=paragraphs(),edited=[p('a','AlXpha'),p('b','Beta')];
  replaceBookmarkMarkers(old.slice(0,2),edited,2,2,1);
  expect(bookmarkEntries(edited)[0]).toMatchObject({start:0,end:12});
  expect(edited[1].bookmarks[0]).toMatchObject({blockBoundary:'after',offset:5});
  const split=[p('a','Al'),p('new','pha'),p('b','Beta')];
  replaceBookmarkMarkers(old.slice(0,2),split,2,2,1);
  expect(bookmarkEntries(split)[0]).toMatchObject({start:0,end:12});
});
it('does not allow ordinary inline markers beyond the paragraph text',()=>{
  const ps=paragraphs();delete ps[1].bookmarks[0].blockBoundary;
  expect(()=>bookmarkEntries(ps)).toThrow('Invalid bookmark position');
});
