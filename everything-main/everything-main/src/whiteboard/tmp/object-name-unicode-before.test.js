import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM}from 'jsdom';import {objectNameHTML}from '../src/accessibility/object-content.js';import {item}from '../src/model.js';
for(const length of [87,88,89])test(`object previews preserve Unicode at a ${length}-character prefix`,()=>{
 const node=item('rect',0,0,{text:'Q'.repeat(length)+'😀',lang:'fr-CA'});
 const dom=new JSDOM('<div>'+objectNameHTML(node,100)+'</div>');
 try{
 const caption=dom.window.document.querySelector('div').textContent;
 assert.equal(caption,'Rectangle: '+'Q'.repeat(length)+(length===87?'😀':''));
 assert.equal(caption.isWellFormed(),true);
 assert.equal(node.text,'Q'.repeat(length)+'😀');
 }finally{dom.window.close();}
});
