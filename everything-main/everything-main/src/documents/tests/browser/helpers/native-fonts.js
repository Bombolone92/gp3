import {test} from '@playwright/test';

// Canvas family selection can succeed through fontconfig aliases. That is
// useful fallback rendering, but is not evidence that the native reference face
// is installed. Keep native-reference tolerances and require actual local faces.
export async function requireNativeWordFonts(page,families){
  const missing=await page.evaluate(async families=>{
    const missing=[];
    for(const family of families) {
      try {await new FontFace('reference probe',`local(${JSON.stringify(family)})`).load();}
      catch {missing.push(family);}
    }
    return missing;
  },families);
  test.skip(missing.length>0,`Native reference requires installed faces: ${missing.join(', ')}. Font aliases are not the reference font.`);
}
