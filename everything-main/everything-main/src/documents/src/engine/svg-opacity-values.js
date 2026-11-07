const number=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const cssNumber=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
export const svgOpacityNumber=value=>value!=null&&number.test(value.trim())&&Number.isFinite(Number(value));
export const nativeCssOpacity=(value,inline=false)=>cssNumber.test(value.trim())&&svgOpacityNumber(value)||inline&&value.trim().toLowerCase()==='inherit';

// Retain non-opacity declarations verbatim when freezing source styles for use.
export function nativeOpacityDeclarations(value) {
  return value.split(';').filter(d=>{const m=/^\s*opacity\s*:\s*(.*?)\s*$/i.exec(d);return !m||nativeCssOpacity(m[1]);}).join(';');
}
