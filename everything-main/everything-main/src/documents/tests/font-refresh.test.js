import {afterEach,expect,it,vi} from 'vitest';
import {CanvasEditor} from '../src/engine/canvas-editor.js';
import * as fonts from '../src/engine/canvas-text.js';
import * as images from '../src/engine/images.js';
import {StorySession} from '../src/engine/story-session.js';
afterEach(()=>vi.restoreAllMocks());
// Page stories as DocxPackage reads them: one section and no header/footer stories.
const pageStories=()=>({sections:[{header:{},footer:{},firstPageDifferent:false}],stories:{}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(){
 const old={close:vi.fn()},next={close:vi.fn()};
 const model={revision:2,assets:{},styles:{},history:['edit'],selection:{start:3,end:5}};
 const editor=Object.assign(Object.create(CanvasEditor.prototype),{session:new StorySession(model,pageStories()),images:new Map([['old',old]]),borrowedImages:new Set(),measureCache:new Map(),relayout:vi.fn(),zoom:1.5});
 const prepare=vi.spyOn(fonts,'loadCanvasFonts').mockResolvedValue();
 const decode=vi.spyOn(images,'decodeImages').mockResolvedValue(new Map([['next',next]]));
 return {editor,old,next,prepare,decode,run:()=>CanvasEditor.prototype.refreshFonts.call(editor)};
}
it('refreshes presentation without changing model, selection or zoom',async()=>{
 const s=setup(),before=JSON.stringify(s.editor.model);await s.run();
 expect(JSON.stringify(s.editor.model)).toBe(before);expect(s.editor.zoom).toBe(1.5);
 expect(s.prepare).toHaveBeenCalledWith({...s.editor.model,pageStories:pageStories()});
 expect(s.editor.images.get('next')).toBe(s.next);expect(s.old.close).toHaveBeenCalledOnce();expect(s.editor.relayout).toHaveBeenCalledOnce();
});
it('refreshing borrowed previews preserves their parent ownership and owns replacements',async()=>{
 const s=setup();s.editor.borrowedImages.add(s.old);await s.run();
 expect(s.old.close).not.toHaveBeenCalled();expect(s.next.close).not.toHaveBeenCalled();
 s.editor.releaseImages(s.editor.images);
 expect(s.old.close).not.toHaveBeenCalled();expect(s.next.close).toHaveBeenCalledOnce();expect(s.editor.images.size).toBe(0);
});
it('refreshes healthy assets in a read-only preview while reporting failed assets',async()=>{
 const s=setup();s.editor.readOnly=true;s.editor.onError=vi.fn();
 s.decode.mockImplementation(async(assets,fonts,missing,failed)=>{failed('bad.png',new Error('Bad pixels'));return new Map([['next',s.next]]);});
 await s.run();expect(s.editor.images.get('next')).toBe(s.next);expect(s.editor.relayout).toHaveBeenCalledOnce();
 expect(s.editor.onError.mock.calls[0][0].message).toBe('Image bad.png: Bad pixels');expect(s.old.close).toHaveBeenCalledOnce();
});
it('coalesces overlapping refresh requests',async()=>{
 const s=setup(),gate=deferred();s.prepare.mockReturnValue(gate.promise);
 const first=s.run(),second=s.run();gate.resolve();await Promise.all([first,second]);expect(s.decode).toHaveBeenCalledOnce();
});
it('discards stale previews and retries when editing changes the model',async()=>{
 const s=setup(),gate=deferred(),stale={close:vi.fn()};s.decode.mockReturnValueOnce(gate.promise);
 const pending=s.run();await vi.waitFor(()=>expect(s.decode).toHaveBeenCalledOnce());s.editor.model.revision++;s.editor.session.revision++;
 gate.resolve(new Map([['stale',stale]]));await pending;
 expect(stale.close).toHaveBeenCalledOnce();expect(s.prepare).toHaveBeenCalledTimes(2);expect(s.editor.images.get('next')).toBe(s.next);
});
it('retries when another story changes without changing the active body revision',async()=>{
 const s=setup(),gate=deferred(),stale={close:vi.fn()},revision=s.editor.model.revision;s.decode.mockReturnValueOnce(gate.promise);
 const pending=s.run();await vi.waitFor(()=>expect(s.decode).toHaveBeenCalledOnce());s.editor.session.revision++;
 gate.resolve(new Map([['stale',stale]]));await pending;
 expect(s.editor.model.revision).toBe(revision);expect(stale.close).toHaveBeenCalledOnce();expect(s.prepare).toHaveBeenCalledTimes(2);expect(s.editor.images.get('next')).toBe(s.next);
});
it('releases pending previews without rendering a destroyed editor',async()=>{
 const s=setup(),gate=deferred();s.decode.mockReturnValue(gate.promise);
 const pending=s.run();await vi.waitFor(()=>expect(s.decode).toHaveBeenCalledOnce());s.editor.destroyed=true;gate.resolve(new Map([['next',s.next]]));await pending;
 expect(s.next.close).toHaveBeenCalledOnce();expect(s.editor.relayout).not.toHaveBeenCalled();expect(s.old.close).not.toHaveBeenCalled();
});
it('retains existing previews on preparation failure and allows retry',async()=>{
 const s=setup();s.prepare.mockRejectedValueOnce(new Error('font failure'));
 await expect(s.run()).rejects.toThrow('font failure');expect(s.editor.images.get('old')).toBe(s.old);expect(s.old.close).not.toHaveBeenCalled();
 await s.run();expect(s.editor.images.get('next')).toBe(s.next);
});
it('restores the old image map if layout fails',async()=>{
 const s=setup();s.editor.relayout.mockImplementation(()=>{throw Error('layout failure');});
 await expect(s.run()).rejects.toThrow('layout failure');expect(s.next.close).toHaveBeenCalledOnce();expect(s.old.close).not.toHaveBeenCalled();expect(s.editor.images.get('old')).toBe(s.old);
});
