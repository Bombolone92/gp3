const fail = reason => { throw new Error(`Unsupported EMF: ${reason}.`); };
const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function emfFontFamilies(font) {
  // GDI accepts full face names. CSS family lookup may need the family with
  // that same style expressed separately; retain the full name as first choice.
  let family=font.family;
  if(font.italic)family=family.replace(/\s+(?:Italic|Oblique)$/i,'');
  if(font.weight>=600)family=family.replace(/\s+Bold$/i,'');
  return [...new Set([font.family,family])];
}
function fontFamilies(font) {
  const quote=s=>'"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
  return emfFontFamilies(font).map(quote).join(', ');
}
export function emfFont(view) {
  if (view.byteLength < 104) fail('truncated logical font');
  const height=view.getInt32(12,true),width=view.getInt32(16,true),weight=view.getInt32(28,true);
  // Creating/selecting a logical font does not paint it. Some metafiles restore
  // an otherwise unsupported font after the final text output.
  const unsupportedDimensions=height>=0||height < -100000||!!width||!!view.getInt32(20,true)||!!view.getInt32(24,true);
  if (weight<0||weight>1000||[32,33,34].some(i=>view.getUint8(i)>1)) fail('font style');
  if (![0,1].includes(view.getUint8(35))) fail('font character set');
  let family='';for(let i=40;i<104;i+=2){const c=view.getUint16(i,true);if(!c)break;family+=String.fromCharCode(c);}
  if (!family||/[\u0000-\u001f\ud800-\udfff]/u.test(family)) fail('font family');
  return {type:'font',family,height:-height,unsupportedDimensions,weight:weight||400,italic:!!view.getUint8(32),underline:!!view.getUint8(33),strike:!!view.getUint8(34)};
}

export function emfText(view,state,matrix) {
  if(view.byteLength<76||!state.font||state.font.stock)fail('missing text font or header');
  const u=i=>view.getUint32(i,true),s=i=>view.getInt32(i,true);
  const count=u(44),offset=u(48),options=u(52),dx=u(72),pdy=!!(options&8192);
  if(![1,2].includes(u(24))||options&~(8192|4)||state.backgroundMode!==1)fail('text mode or background');
  if(!count)return '';
  if(state.font.unsupportedDimensions)fail('font dimensions or rotation');
  if(count>32768||offset<76||offset%2||offset+count*2>view.byteLength||dx<76||dx%4||dx+count*(pdy?8:4)>view.byteLength)fail('text buffers');
  const bytes=new Uint8Array(view.buffer,view.byteOffset+offset,count*2);
  let text;try{text=new TextDecoder('utf-16le',{fatal:true}).decode(bytes);}catch{fail('invalid Unicode text');}
  if(/[\u0000-\u001f\ufffe\uffff]/u.test(text))fail('control characters in text');
  const align=state.textAlign||0;
  if(![0,2,6,8,10,14,24,26,30].includes(align))fail('text alignment');
  const advances=Array.from({length:count},(_,i)=>[s(dx+i*(pdy?8:4)),pdy?s(dx+i*8+4):0]);
  if(advances.some(p=>p.some(v=>Math.abs(v)>1000000)))fail('text advance');
  let x=s(36),y=s(40);const total=advances.reduce((a,p)=>[a[0]+p[0],a[1]+p[1]],[0,0]);
  const anchor=(align&6)===6?.5:(align&6)===2?1:0;x-=total[0]*anchor;y+=total[1]*anchor;
  const compatible=u(24)===1;
  const heightScale=compatible?Math.hypot(matrix[2],matrix[3]):1;
  const outputMatrix=compatible?[1,0,0,1,0,0]:matrix;
  const spans=[];let index=0;
  for(const character of text){
    const px=compatible?matrix[0]*x+matrix[2]*y+matrix[4]:x;
    const py=compatible?matrix[1]*x+matrix[3]*y+matrix[5]:y;
    spans.push(`<tspan x="${px}" y="${py}">${escape(character)}</tspan>`);
    for(let j=0;j<character.length;j++){x+=advances[index][0];y-=advances[index++][1];}
  }
  const f=state.font,baseline=(align&24)===24?'alphabetic':(align&24)===8?'text-after-edge':'text-before-edge';
  const decorations=[f.underline?'underline':'',f.strike?'line-through':''].filter(Boolean).join(' ');
  return `<text transform="matrix(${outputMatrix.join(' ')})" fill="${state.textColor}" font-family="${escape(fontFamilies(f))}" font-size="${f.height*heightScale}" font-weight="${f.weight}" font-style="${f.italic?'italic':'normal'}" dominant-baseline="${baseline}" text-decoration="${decorations||'none'}" xml:space="preserve">${spans.join('')}</text>`;
}
