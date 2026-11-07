import {it,expect,vi,beforeEach} from 'vitest';
const fake=vi.hoisted(()=>({open:vi.fn(),preview:vi.fn(),validate:vi.fn(),decode:vi.fn(),model:vi.fn()}));
vi.mock('../src/engine/docx.js',()=>({DocxPackage:{open:fake.open,preview:fake.preview}}));
vi.mock('../src/engine/canvas-text.js',()=>({validateCanvasLayout:fake.validate}));
vi.mock('../src/engine/images.js',()=>({decodeImages:fake.decode}));
vi.mock('../src/engine/model.js',()=>({TextDocument:class{constructor(...args){fake.model(...args);}}}));
import {openCanvasDocument} from '../src/engine/open-document.js';
beforeEach(()=>{vi.resetAllMocks();fake.decode.mockResolvedValue(new Map());fake.validate.mockResolvedValue({});});
it('preserves the reason when a layout limit has a successful structured preview',async()=>{
 const pkg={paragraphs:[],styles:{},assets:{}};fake.open.mockResolvedValue(pkg);
 fake.validate.mockRejectedValueOnce(new Error('Text exceeds the supported page bounds.')).mockResolvedValue({});
 const result=await openCanvasDocument(new Uint8Array());
 expect(result.pkg.readOnly).toBe(true);expect(result.pkg.previewIssues).toEqual(['Text exceeds the supported page bounds.']);expect(fake.preview).not.toHaveBeenCalled();
});
it('keeps import and decoding reasons when falling back to plain text',async()=>{
 const original={readOnly:true,previewIssues:['Unsupported picture effects'],paragraphs:[],styles:{},assets:{},parts:{}};
 const plain={paragraphs:[],styles:{},assets:{},readOnly:true};fake.open.mockResolvedValue(original);fake.preview.mockReturnValue(plain);fake.validate.mockResolvedValue({});
 fake.decode.mockRejectedValue(new Error('The image cannot be decoded.'));
 const result=await openCanvasDocument(new Uint8Array());
 expect(result.pkg).toBe(plain);expect(result.pkg.previewIssues).toEqual(['Unsupported picture effects','The image cannot be decoded.']);
});
it('retains both layout errors when both structured attempts fail',async()=>{
 fake.open.mockResolvedValue({paragraphs:[],styles:{},assets:{},parts:{}});fake.preview.mockReturnValue({paragraphs:[],styles:{},readOnly:true});
 fake.validate.mockRejectedValueOnce(new Error('Editing limit')).mockRejectedValueOnce(new Error('Preview limit')).mockResolvedValue({});
 expect((await openCanvasDocument(new Uint8Array())).pkg.previewIssues).toEqual(['Editing limit','Preview limit']);
});

it('keeps the imported structure and healthy images when individual decoding fails',async()=>{
 const pkg={paragraphs:[{runs:[{text:'Retained'}]}],styles:{},assets:{},tables:[{id:'table'}],pageSettings:{width:900},previewIssues:['Existing issue']};
 const images=new Map([['healthy',{}]]);fake.open.mockResolvedValue(pkg);
 fake.decode.mockImplementation(async(assets,fonts,missing,failed)=>{failed('word/media/bad.png',new Error('Bad pixels'));return images;});
 const result=await openCanvasDocument(new Uint8Array());
 expect(result.pkg).toBe(pkg);expect(result.images).toBe(images);expect(pkg.readOnly).toBe(true);
 expect(pkg.previewIssues).toEqual(['Existing issue','Image word/media/bad.png: Bad pixels']);
 expect(fake.preview).not.toHaveBeenCalled();expect(fake.validate).toHaveBeenCalledOnce();
});

it('retains local decoding issues when a later aggregate limit forces the emergency preview',async()=>{
 const pkg={paragraphs:[],styles:{},assets:{},parts:{}};fake.open.mockResolvedValue(pkg);
 fake.preview.mockReturnValue({paragraphs:[],styles:{},readOnly:true});
 fake.decode.mockImplementation(async(assets,fonts,missing,failed)=>{failed('bad.png',new Error('Bad pixels'));throw new Error('Aggregate preview limit');});
 const result=await openCanvasDocument(new Uint8Array());
 expect(result.pkg.previewIssues).toEqual(['Image bad.png: Bad pixels','Aggregate preview limit']);
});
