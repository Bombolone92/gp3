import {it,expect} from 'vitest';
import {paintColor,tableBorderColor} from '../src/engine/colors.js';
import {paintTableBorder} from '../src/engine/canvas-table-borders.js';
import {paintParagraphBorder} from '../src/engine/canvas-paragraph-borders.js';
import {winningTableBorder} from '../src/engine/table-border-layout.js';
it.each([undefined,'auto','000000','FFFFFF','124578'])('resolves table border color %s independently of shading',color=>{
 expect(tableBorderColor(color)).toBe('#'+(!color||color==='auto'?'000000':color));
});
it('keeps automatic paragraph/text contrast while table borders remain black',()=>{
 const colors=[];const ctx={save(){},restore(){},fillRect(){colors.push(this.fillStyle);}};
 const stroke={x:0,y:0,width:20,height:2,horizontal:true,border:{style:'single',size:12,color:'auto'},background:'#000000'};
 paintTableBorder(ctx,stroke);paintParagraphBorder(ctx,stroke);
 expect(colors).toEqual(['#000000','#FFFFFF']);expect(paintColor('auto','#000000')).toBe('#FFFFFF');expect(stroke.border.color).toBe('auto');
});
it('uses black for automatic border conflict brightness ties on dark cells',()=>{
 const edge=(color,background,order)=>({border:{style:'single',size:8,color},background,order});
 const auto=edge('auto','#000000',0),gray=edge('444444','#FFFFFF',1);
 expect(winningTableBorder(auto,gray)).toBe(auto);
 expect(winningTableBorder(gray,auto)).toBe(auto);
 const black=edge('000000','#FFFFFF',1);expect(winningTableBorder(auto,black)).toBe(auto);
});
