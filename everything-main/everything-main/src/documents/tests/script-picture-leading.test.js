import {it,expect} from 'vitest';
import {paragraph} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {fontMetrics} from '../src/engine/font-metrics.js';
import {pageGeometry,DEFAULT_PAGE_SETTINGS} from '../src/engine/page-settings.js';

const measure=(text,style)=>({...fontMetrics(style),width:text.length*(style.fontSize??12)*.6});
function control(script,mixed,multiple,compatibilityMode){
 const p=paragraph('');p.format={lineRule:'auto',lineSpacing:multiple};
 p.markFormat={fontSize:mixed?6:12,verticalAlign:mixed?'baseline':script};
 const picture={text:'\ufffc',fontSize:12,verticalAlign:script,image:{id:'original',width:36*12700,height:72*12700}};
 p.runs=mixed?[{text:'Left ',fontSize:6},picture,{text:' Right',fontSize:6}]:[picture];
 return layoutDocument([p],measure,pageGeometry({...DEFAULT_PAGE_SETTINGS,compatibilityMode})).lines[0];
}
for(const mode of [12,15])for(const mixed of [false,true])for(const multiple of [.8,1,259/240,1.5])it(`uses declared picture-font line metrics: mode=${mode}, mixed=${mixed}, spacing=${multiple}`,()=>{
 const base=control('baseline',mixed,multiple,mode);
 for(const script of ['subscript','superscript']){
  const actual=control(script,mixed,multiple,mode);
  expect(actual.height).toBeCloseTo(base.height,8);
  expect(actual.baseline).toBeCloseTo(base.baseline,8);
  expect(actual.fragments.find(f=>f.image).ascent).toBe(base.fragments.find(f=>f.image).ascent);
 }
});
