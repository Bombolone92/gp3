import {describe,it,expect} from 'vitest';
import {paragraph} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {squareRow} from '../src/engine/square-wrap.js';
const measure=text=>({width:text.length*8,ascent:15,descent:5});
const p=(count,format={})=>paragraph(Array(count).fill('Text').join('\v'),{format:{lineSpacing:2,spaceAfter:0,widowControl:false,...format}});
const layout=(ps,height=100)=>layoutDocument(ps,measure,{width:240,height,margin:20});

describe('automatic leading at the page bottom',()=>{
  it('keeps the actual page exclusions for a bottom line with expanded leading',()=>{
    const hints={paragraphs:new Map([['p',[{height:40,fitHeight:20,y:60,page:0,start:0}]]]),
      exclusions:[{page:0,left:20,right:100,top:50,bottom:90,side:'both'}]};
    expect(squareRow(hints,'p',0,{left:20,right:220},{height:100,top:20,bottom:20})).toEqual({intervals:[{left:100,right:220}],before:0});
  });
  it('retains the full baseline advance while fitting the final natural extent',()=>{
    const result=layout([p(2)]);expect(result.pageCount).toBe(1);
    expect(result.lines.map(l=>[l.y,l.height,l.fitHeight])).toEqual([[20,40,20],[60,40,20]]);
  });
  it('does not push a keepLines paragraph whose final extent fits',()=>{
    const result=layout([p(1,{lineSpacing:1}),p(2,{keepLines:true})],120);
    expect(result.lines.map(l=>l.page)).toEqual([0,0,0]);
  });
  it('uses the final extent for keepNext chains',()=>{
    const result=layout([p(1,{keepNext:true}),p(1)]);expect(result.lines.map(l=>l.page)).toEqual([0,0]);
  });
  it('fits widow-controlled pairs using full advances except for the final line',()=>{
    const result=layout([p(4,{widowControl:true})]);expect(result.lines.map(l=>l.page)).toEqual([0,0,1,1]);
  });
  it.each(['exact','atLeast'])('retains full %s allocation',lineRule=>{
    const result=layout([p(2,{lineRule,lineSpacing:30})]);expect(result.lines.map(l=>l.page)).toEqual([0,1]);
  });
  it('retains compressed automatic allocation',()=>{
    const result=layout([p(3,{lineSpacing:.5})],70);expect(result.pageCount).toBe(1);expect(result.lines.map(l=>l.fitHeight)).toEqual([10,10,10]);
  });
});
