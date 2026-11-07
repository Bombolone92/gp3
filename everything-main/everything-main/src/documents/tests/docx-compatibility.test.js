import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { activeDescendants, MC, WPS } from '../src/engine/docx-compatibility.js';
let dom;
beforeAll(()=>{dom=new JSDOM();});
afterAll(()=>dom.window.close());
const parse=xml=>new dom.window.DOMParser().parseFromString(xml,'application/xml').documentElement;
it('walks selected nested branches in document order and ignores inactive compatibility attributes',()=>{
 const root=parse(`<root xmlns:mc="${MC}" xmlns:wps="${WPS}" xmlns:future="urn:future"><before/><mc:AlternateContent><mc:Choice Requires="future" mc:MustUnderstand="future"><ignored/></mc:Choice><mc:Choice Requires="wps"><selected/><mc:AlternateContent><mc:Choice Requires="future"><ignored/></mc:Choice><mc:Fallback><fallback><child/></fallback></mc:Fallback></mc:AlternateContent></mc:Choice><mc:Fallback mc:ProcessContent="future:ignored"><ignored/></mc:Fallback></mc:AlternateContent><after/></root>`);
 expect(activeDescendants(root).map(n=>n.localName)).toEqual(['before','selected','fallback','child','after']);
});
it.each(['root','container','choice','fallback','leaf'])('checks compatibility requirements on the active %s',where=>{
 const root=parse(`<root xmlns:mc="${MC}" xmlns:wps="${WPS}" xmlns:future="urn:future"><mc:AlternateContent><mc:Choice Requires="${where==='fallback'?'future':'wps'}"><leaf/></mc:Choice><mc:Fallback><leaf/></mc:Fallback></mc:AlternateContent></root>`);
 const node=where==='root'?root:where==='container'?root.firstElementChild:where==='choice'?root.firstElementChild.firstElementChild:where==='fallback'?root.firstElementChild.lastElementChild:root.getElementsByTagName('leaf')[0];
 node.setAttributeNS(MC,'mc:MustUnderstand','future');expect(()=>activeDescendants(root)).toThrow(/MustUnderstand/);
});
it('does not silently switch to fallback after an unsupported active feature',()=>{
 const root=parse(`<root xmlns:mc="${MC}" xmlns:wps="${WPS}"><mc:AlternateContent><mc:Choice Requires="wps" mc:ProcessContent="wps:any"><selected/></mc:Choice><mc:Fallback><safe/></mc:Fallback></mc:AlternateContent></root>`);
 expect(()=>activeDescendants(root)).toThrow(/ProcessContent/);
});
