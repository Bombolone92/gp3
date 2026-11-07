import { StorySession } from './story-session.js';
import { inlineControlCaret, adjacentInlineControl, moveInlineControlCaret, documentStartControlCaret, moveInlineControlHomeEnd, emptyControlPointerCaret } from './content-control-caret.js';
import { paintControlCarets } from './canvas-control-caret.js';
import { cellTextLocalPoint } from './cell-text-direction.js';
import { pageStorySelectionLayout } from './page-story-positions.js';
import { pageStoryAtPoint } from './page-story-hit.js';
import { paintImage } from './paint-image.js';
import { prepareText3dFonts } from './text-3d-fonts.js';
import { localFontVersion } from './local-fonts.js';
import { text3dSurface } from './text-3d.js';
import { enterCellText, leaveCellText } from './canvas-cell-text.js';
import { tableBorderWidth } from './table-border-layout.js';
import { layoutPageStories } from './page-story-layout.js';
import { drawingPageContexts, drawingPageContext } from './shape-page-fields.js';
import { paintParagraphBorder } from './canvas-paragraph-borders.js';
import { paintTableBorder } from './canvas-table-borders.js';
import { deviceTableBorders } from './border-device-layout.js';
import { paragraphBackgrounds, paintOnParagraphBackground } from './paragraph-backgrounds.js';
import { paintParagraphBackgrounds } from './canvas-paragraph-backgrounds.js';
import { hyperlinkAtPoint } from './hyperlink-hit.js';
import { internalHyperlink, hyperlinkLabel } from './hyperlinks.js';
import { paintUnderline } from './canvas-underlines.js';
import { paintText, paintTextShadows } from './canvas-paint-text.js';
import { strikeSpans } from './strikethrough.js';
import { setCanvasTextStyle, measureCanvasText, setCanvasFontAlternatives, loadCanvasFonts } from './canvas-text.js';
import { hasRunBackground, runBackground, foregroundBackground, runBackgroundRect } from './backgrounds.js';
import { paintColor } from './colors.js';
import { TextDocument, boundaries, locate, paragraphFormat } from './model.js';
import { cellContext } from './tables.js';
import { paragraphEdges } from './paragraph-geometry.js';
import { pageGeometry } from './page-settings.js';
import { pageBorderStrokes } from './page-borders.js';
import { paintPagePictureBackground } from './canvas-page-background.js';
import { font, layoutDocument, caretRect, lineAtPosition, verticalLine, hitTestStop, nearestStop, imageAtPoint, selectionRects } from './layout.js';
import { refreshPageReferences } from './page-reference-refresh.js';
import { positionedImageBounds } from './positioned-images.js';
import { createImageInteraction } from './image-interaction.js';
import { paintDecodedImage, imageInfo, decodeImage, decodeImages, validateImageAssets, imageCropRect, inlineImagePaintFrame, normalizedRotation, ANGLE_PER_DEGREE, EMU_PER_PX, isPositionedImage } from './images.js';
let nextAsset = 0;

/** Canvas paint surface plus a real textarea for native input, composition and accessible text. */
export class CanvasEditor {
  constructor(host, { paragraphs, pageSettings, numbering, styles, tables, pageStories, assets = {}, images = new Map(), drawingLayouts, readOnly = false, onChange = () => {}, onSelection = () => {}, onSave = () => {}, onLink = () => {}, onOpenLink = () => {}, onError = () => {}, onContextMenu = () => {} } = {}) {
    this.host = host;
    this.readOnly = readOnly;
    this.session = new StorySession(new TextDocument(paragraphs, pageSettings, numbering, styles, tables, assets, { displayOnly: readOnly }), pageStories);
    this.storyPage = 0;
    this.images = images;
    this.drawingLayouts = drawingLayouts;
    this.onChange = onChange; this.onSelection = onSelection; this.onSave = onSave; this.onError = onError;
    this.onLink = onLink; this.onOpenLink = onOpenLink; this.visitedLinks = new Set();
    this.zoom = 1;
    this.destroyed = false;
    this.composition = null;
    this.accessible = false;
    this.preferredX = null;
    this.caretAffinity = 'forward';
    this.caretPage = null;
    this.abort = new AbortController();
    this.pages = document.createElement('div'); this.pages.className = 'canvas-pages';
    this.input = document.createElement('textarea');
    this.input.className = 'canvas-input';
    this.input.readOnly = readOnly;
    this.input.setAttribute('aria-label', 'Document text');
    this.input.setAttribute('aria-describedby', 'canvas-input-help');
    this.input.setAttribute('spellcheck', 'false');
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('autocomplete', 'off');
    this.input.wrap = 'off';
    this.input.style.font = font({});
    this.input.setAttribute('data-testid', 'document-input');
    host.replaceChildren(this.pages, this.input);
    this.imageInteraction = createImageInteraction(this);
    const measureCanvas = document.createElement('canvas');
    const context = measureCanvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable in this browser.');
    setCanvasFontAlternatives(context, this.model.styles.fontAlternatives);
    const separatorReady=()=>{if(!this.destroyed){try{this.relayout();this.revealCaret();}catch(error){this.onError(error);}}};
    this.measure = (text, style) => measureCanvasText(context, text, style,separatorReady);
    const listen = (node, name, fn) => node.addEventListener(name, fn, { signal: this.abort.signal });
    listen(this.pages, 'pointerdown', e => this.pointerDown(e));
    listen(this.pages, 'pointermove', e => this.pointerMove(e));
    listen(this.pages, 'pointerup', e => this.pointerUp(e));
    listen(this.pages, 'pointercancel', () => { this.dragging = false; this.dragControl = null; this.imageInteraction.cancel(); });
    listen(this.pages, 'contextmenu', e => {
      e.preventDefault(); const selected=this.model.selectedImage, position = this.point(e, false), normal=this.pointImage;
      this.point({clientX:e.clientX,clientY:e.clientY,altKey:true},false);
      const candidate=this.pointImage, picture=normal || (selected && candidate?.image.id===selected.id ? candidate : null);
      if (picture) this.model.select(picture.start, picture.end);
      else if (position < this.model.range[0] || position > this.model.range[1]) this.model.select(position, position);
      this.focus(); this.onSelection();
      const behind = !this.model.selectedImage && candidate;
      onContextMenu({event:e, behind, selectBehind:()=>{ if(behind){this.model.select(behind.start,behind.end);this.focus();this.onSelection();} }});
    });
    listen(this.pages, 'dblclick', e => this.selectWord(e));
    listen(this.input, 'keydown', e => this.keydown(e));
    listen(this.input, 'contextmenu', e => {e.preventDefault();onContextMenu({event:e});});
    listen(this.input, 'beforeinput', e => this.beforeInput(e));
    listen(this.input, 'input', e => this.nativeInput(e));
    listen(this.input, 'compositionstart', () => {
      if (this.readOnly) return;
      const entry = this.session.capture(), before = entry.state, [start, end] = this.model.range;
      const caret = this.model.selection.controlCaret;
      const explicit = caret && inlineControlCaret(this.model.paragraphs, start, caret);
      const placeholder = caret ? caret.side === 'inside' && explicit?.control.placeholder && explicit : this.model.placeholderAt(start);
      if (placeholder && end <= placeholder.end) {
        this.model.select(placeholder.start, placeholder.end);
        this.model.typingFormat = { ...before.typingFormat }; this.model.typingStyle = before.typingStyle; this.model.typingDirectCleared = before.typingDirectCleared;
        this.syncInput(); this.paint();
      }
      this.composition = entry;
    });
    listen(this.input, 'compositionend', () => this.finishComposition());
    listen(this.input, 'select', () => this.nativeSelection());
    listen(this.input, 'keyup', () => this.nativeSelection());
    listen(this.input, 'focus', () => this.paint());
    listen(this.input, 'blur', () => { this.finishComposition(); this.paint(); });
    listen(this.input, 'copy', e => this.copy(e, false));
    listen(this.input, 'cut', e => this.copy(e, true));
    listen(this.input, 'paste', e => {
      if (this.composition || !e.clipboardData) return;
      e.preventDefault();
      this.execute(() => this.model.replace(e.clipboardData.getData('text/plain')));
    });
    this.relayout();
  }
  focus() { this.input.focus({ preventScroll: true }); this.syncInput(); this.paint(); }
  get model() { return this.session.model; }
  get pageStories() { return this.session.pageStories; }
  exportText() { return this.session.body.text; }
  export(pkg) { return this.session.export(pkg); }
  editStory(path = null, page = 0) {
    if (this.readOnly || path !== null && !this.pageStories?.stories[path]?.editable) return false;
    this.finishComposition();
    this.session.activate(path); this.session.page = page; this.storyPage = page; this.caretPage = page;
    this.caretAffinity = 'forward'; this.preferredX = null;
    this.relayout(); this.focus(); this.revealCaret(); return true;
  }
  validateStory() {
    if (this.session.path === null) return;
    for (const p of this.model.paragraphs) {
      if (p.sectionEnd || p.bookmarks?.length) throw new Error('Sections and bookmarks cannot be added to headers or footers yet.');
      for (const r of p.runs) if (r.field && (r.text !== '\ufffc' || Object.keys(r.overrides || {}).length || r.styleChanged)) throw new Error('Page-field formatting cannot be changed yet. Select the surrounding text instead.');
    }
  }
  async refreshFonts() {
    if (this.destroyed) return;
    if (this.fontRefresh) return this.fontRefresh;
    this.fontRefresh = (async () => {
      // Font access changes presentation, never document formatting or history.
      // Rebuild retained text/diagram previews as well as body/story metrics.
      while (!this.destroyed) {
        const revision = this.session.revision;
        const fontVersion = localFontVersion();
        await loadCanvasFonts({ ...this.model, pageStories: this.pageStories });
        if (this.destroyed) return;
        const missing = new Set();
        const images = await decodeImages(this.model.assets, this.model.styles.fontAlternatives, name => missing.add(name),
          this.readOnly ? (id, error) => this.onError(new Error(`Image ${id}: ${error.message}`)) : undefined);
        if (this.destroyed || revision !== this.session.revision || fontVersion !== localFontVersion()) {
          for (const image of images.values()) image.close?.();
          continue;
        }
        const previous = this.images;
        this.images = images;
        try { this.relayout(); }
        catch (error) {
          this.images = previous;
          for (const image of images.values()) image.close?.();
          throw error;
        }
        for (const image of previous.values()) image.close?.();
        previous.clear();
        this.missingPictureFonts = [...missing];
        return;
      }
    })();
    try { await this.fontRefresh; }
    finally { this.fontRefresh = null; }
  }
  selectMatch(match) {
    this.finishComposition(); this.model.select(match.start, match.end);
    this.caretAffinity = 'forward'; this.caretPage = null; this.preferredX = null;
    this.syncInput(); this.paint(); this.revealCaret(); this.onSelection();
  }
  replaceMatches(query, text, options, all) {
    this.finishComposition(); let count = 0, failure;
    const ok = this.execute(() => { count = this.model.replaceMatches(query, text, options, all); return count > 0; }, e => { failure = e; });
    if (!ok) throw failure || new Error('The replacement could not fit the document. Try shorter text.');
    return count;
  }
  execute(action, onFailure) {
    if (this.readOnly || this.composition) return;
    try {
      const revision = this.session.revision;
      this.session.run(() => action(), () => {
        this.validateStory(); this.preferredX = null; this.caretAffinity = 'forward';
        this.relayout(); this.revealCaret();
      });
      if (this.session.revision !== revision) this.onChange();
      return true;
    } catch (e) {
      this.relayout(); this.onError(e); onFailure?.(e); return false;
    }
  }
  setTableProperties(patch) { return this.execute(() => this.model.setTableProperties(patch)); }
  updatePageReferences() {
    if (this.session.path !== null) { this.onError(new Error('Update page references from the document body.')); return false; }
    let result;
    const ok = this.execute(() => {
      result = refreshPageReferences(this.model, model => layoutDocument(model.paragraphs, this.measure, pageGeometry(model.pageSettings), model.numbering, model.tables, this.pageStories, { styles: model.styles, drawingLayouts: this.drawingLayouts }), this.pageStories, { checkpoint: false });
    });
    if (ok && result?.issues.length) this.onError(new Error([...new Set(result.issues.map(issue => issue.message))].join(' ')));
    this.syncInput(); this.onSelection(); return ok;
  }
  setCellVerticalAlignment(value) { return this.execute(() => this.model.setCellVerticalAlignment(value)); }
  setCellShading(value) { return this.execute(() => this.model.setCellShading(value)); }
  setCellBorders(value) { return this.execute(() => this.model.setCellBorders(value)); }
  setCellMargins(value) { return this.execute(() => this.model.setCellMargins(value)); }
  setTableRowHeight(value) { return this.execute(() => this.model.setTableRowHeight(value)); }
  setImageProperties(patch) { return this.execute(() => this.model.setImageProperties(patch)); }
  async insertImageFile(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or TIFF image up to 10 MB.');
    this.finishComposition();
    const path = this.session.path, revision = this.session.revision, selection = { ...this.model.selection }, bytes = new Uint8Array(await file.arrayBuffer()), info = imageInfo(bytes), asset = { bytes, mime: info.mime };
    validateImageAssets(this.model.assets, asset);
    const bitmap = await decodeImage(asset);
    if (this.destroyed) { bitmap.close(); return false; }
    if (path !== this.session.path || revision !== this.session.revision || selection.anchor !== this.model.selection.anchor || selection.focus !== this.model.selection.focus) { bitmap.close(); throw new Error('The insertion position changed while the image opened. Select its position and insert it again.'); }
    const line = lineAtPosition(this.selectionLayout, this.model.range[0], 'forward', this.caretPage), p = this.layout.pages[line.page] || this.layout.page;
    const paragraph = this.model.paragraphs[locate(this.model.paragraphs, this.model.range[0]).index], context = cellContext(this.model.tables, paragraph.cellId);
    const cell = this.selectionLayout.cells.find(c => c.id === line.cellId && c.page === line.page && c.column === line.column);
    const cellPage = cell ? { ...p, left: cell.x + context.cell.margins.left / 15, right: p.width - cell.x - cell.width + context.cell.margins.right / 15 } : p;
    const format = paragraphFormat(paragraph, this.model.numbering), edges = [true, false].map(first => paragraphEdges(format, cellPage, first));
    const width = Math.min(...edges.map(e => e.right - e.left));
    const height = Math.max(1, (p.height - p.top - p.bottom) / (format.lineRule === 'auto' ? format.lineSpacing : 1) - 32), scale = Math.min(1, width / bitmap.width, height / bitmap.height);
    let id; do { id = `canvas-image-${++nextAsset}`; } while (this.model.assets[id]);
    this.model.assets[id] = asset; this.images.set(id, bitmap);
    const ok = this.execute(() => this.model.insertImage(id, { width: Math.max(1, Math.floor(bitmap.width * scale * EMU_PER_PX)), height: Math.max(1, Math.floor(bitmap.height * scale * EMU_PER_PX)), alt: '' }));
    if (!ok) { delete this.model.assets[id]; this.images.delete(id); bitmap.close(); }
    this.focus(); return ok;
  }
  fitTable(mode) { this.execute(() => this.model.fitTable(mode)); this.focus(); }
  mergeCells() { this.execute(() => this.model.mergeCells()); this.focus(); }
  mergeCellBelow() { this.execute(() => this.model.mergeCellBelow()); this.focus(); }
  splitCell() { this.execute(() => this.model.splitCell()); this.focus(); }
  setTableRowKeep(value) { this.execute(() => this.model.setTableRowKeep(value)); this.focus(); }
  setTableHeaderRows(count) { this.execute(() => this.model.setTableHeaderRows(count)); this.focus(); }
  insertTable(rows, columns) {
    return this.execute(() => {
      const parent = this.model.tableContext;
      const box = parent && this.selectionLayout.cells.find(cell => cell.id === parent.cell.id);
      const width = box ? box.width * 15 - Math.max(parent.cell.margins.left, tableBorderWidth(box.borders.left) * 15 / 2) - Math.max(parent.cell.margins.right, tableBorderWidth(box.borders.right) * 15 / 2) : undefined;
      return this.model.insertTable(rows, columns, width);
    });
  }
  insertTableRow() { this.execute(() => this.model.insertTableRow()); this.focus(); }
  insertTableParagraph(after) { this.execute(() => this.model.insertTableParagraph(after)); this.focus(); }
  insertTableColumn() { this.execute(() => this.model.insertTableColumn()); this.focus(); }
  deleteTablePart(kind) { this.execute(() => this.model.deleteTablePart(kind)); this.focus(); }
  setCharacterStyle(id) { this.execute(() => this.model.setCharacterStyle(id)); this.focus(); }
  editCharacterStyle(id, patch) { return this.execute(() => this.model.editCharacterStyle(id, patch)); }
  createCharacterStyle(name, basedOn) { return this.execute(() => this.model.createCharacterStyle(name, basedOn)); }
  setParagraphStyle(id) { this.execute(() => this.model.setParagraphStyle(id)); this.focus(); }
  setOutlineLevel(value) { this.execute(() => this.model.setOutlineLevel(value)); this.focus(); }
  get outline() { return this.model.outline.map(entry => ({ ...entry, page: lineAtPosition(this.selectionLayout, entry.start, 'forward').page + 1 })); }
  goToParagraph(id) {
    this.finishComposition();
    const index = this.model.paragraphs.findIndex(p => p.id === id); if (index < 0) return false;
    this.model.select(this.model.paragraphOffset(index));
    this.caretAffinity = 'forward'; this.caretPage = null; this.preferredX = null;
    this.focus(); this.revealCaret(); this.onSelection(); return true;
  }
  editParagraphStyle(id, patch) { return this.execute(() => this.model.editParagraphStyle(id, patch)); }
  createParagraphStyle(name, basedOn) { return this.execute(() => this.model.createParagraphStyle(name, basedOn)); }
  toggleBold() { this.execute(() => this.model.toggleBold()); this.focus(); }
  setRunFormat(patch) { this.execute(() => this.model.setRunFormat(patch)); this.focus(); }
  setFontSize(size) { this.execute(() => this.model.setFontSize(size)); this.focus(); }
  toggleItalic() { this.execute(() => this.model.toggleItalic()); this.focus(); }
  toggleUnderline() { this.execute(() => this.model.toggleUnderline()); this.focus(); }
  clearDirectTextFormatting() { this.finishComposition(); const ok = this.execute(() => this.model.clearDirectTextFormatting()); this.focus(); return ok; }
  clearDirectParagraphFormatting() { this.finishComposition(); const ok = this.execute(() => this.model.clearDirectParagraphFormatting()); this.focus(); return ok; }
  setParagraphFormat(patch) { this.execute(() => this.model.setParagraphFormat(patch)); this.focus(); }
  setParagraphLineSpacing(value) { return this.execute(() => this.model.setParagraphLineSpacing(value)); }
  setParagraphGeometry(patch, defaultTabStop) { return this.execute(() => this.model.setParagraphGeometry(patch, defaultTabStop)); }
  toggleList(kind) { this.execute(() => this.model.toggleList(kind)); this.focus(); }
  changeListLevel(delta) { this.execute(() => this.model.changeListLevel(delta)); this.focus(); }
  restartNumbering() { this.execute(() => this.model.restartNumbering()); this.focus(); }
  adjustIndent(delta) { this.execute(() => this.model.adjustIndent(delta)); this.focus(); }
  insertTab() { this.execute(() => this.model.replace('\t')); this.focus(); }
  setPageSettings(patch) { return this.execute(() => this.model.setPageSettings(patch)); }
  insertPageBreak() { this.execute(() => this.model.insertPageBreak()); this.focus(); }
  travelHistory(direction) {
    if (this.readOnly || this.composition) return;
    try {
      if (this.session[direction](() => { this.validateStory(); this.relayout(); })) this.onChange();
      this.focus(); this.revealCaret();
    } catch (e) { this.relayout(); this.onError(e); }
  }
  undo() { this.travelHistory('undo'); }
  redo() { this.travelHistory('redo'); }
  setZoom(value) {
    if (!Number.isFinite(value)) return;
    this.zoom = Math.max(0.1, Math.min(2, value));
    this.resizeCanvases();
  }
  setAccessible(value) {
    this.accessible = value;
    this.host.classList.toggle('accessible-editing', value);
    this.syncInput(); this.paint(); this.focus();
  }
  relayout() {
    const body = this.session.body;
    this.layout = layoutDocument(body.paragraphs, this.measure, pageGeometry(body.pageSettings), body.numbering, body.tables, this.pageStories, { bestEffort: this.readOnly, drawingLayouts: this.drawingLayouts, ...(!this.readOnly ? { styles: this.model.styles } : {}) });
    this.storyLayout = layoutPageStories(this.layout, this.pageStories, [...body.paragraphs.filter(p => p.sectionEnd).map(p => p.sectionEnd), body.pageSettings], this.measure, this.model.numbering, { bestEffort: this.readOnly, drawingLayouts: this.drawingLayouts, ...(!this.readOnly ? { styles: this.model.styles } : {}) });
    if (this.session.path !== null) {
      this.storyPage = this.session.page;
      const occurrences = this.storyLayout.positions.filter(p => p.path === this.session.path);
      this.storyPage = occurrences.find(p => p.page === this.storyPage)?.page ?? occurrences[0]?.page;
      if (this.storyPage === undefined) this.session.activate(null);
      else this.session.page = this.storyPage;
    }
    this.selectionLayout = this.session.path === null ? this.layout : pageStorySelectionLayout(this.layout, this.storyLayout, this.session.path, this.storyPage);
    this.input.setAttribute('aria-label', this.session.path === null ? 'Document text' : this.pageStories.stories[this.session.path].kind === 'header' ? 'Header text' : 'Footer text');
    this.drawingPageContexts = drawingPageContexts(this.layout, this.pageStories);
    while (this.pages.children.length > this.layout.pageCount) this.pages.lastChild.remove();
    while (this.pages.children.length < this.layout.pageCount) {
      const canvas = document.createElement('canvas');
      canvas.className = 'canvas-page';
      canvas.setAttribute('aria-hidden', 'true');
      this.pages.append(canvas);
    }
    this.canvases = [...this.pages.children];
    this.resizeCanvases();
    // Font and style edits can introduce an effect face absent at import time.
    // Prepare outlines without delaying input; repaint only the latest layout.
    const effectStyles = new Map();
    for (const lines of [this.layout.lines, this.storyLayout.lines]) for (const line of lines) for (const fragment of line.fragments) {
      for (const color of fragment.colors?.length ? fragment.colors : [fragment]) {
        if (!color.text3d) continue;
        const style = { ...fragment, ...color };
        if (text3dSurface(style)) effectStyles.set(`${style.fontFamily}/${!!style.bold}/${!!style.italic}`, style);
      }
    }
    const layout = this.layout;
    if (effectStyles.size) prepareText3dFonts([...effectStyles.values()], this.model.styles.fontAlternatives).then(changed => {
      if (changed && !this.destroyed && this.layout === layout) this.paint();
    });
  }
  resizeCanvases() {
    this.canvases.forEach((canvas, index) => {
      const geometry = this.layout.pages[index] || this.layout.page;
      canvas.dataset.page = index;
      canvas.style.width = `${geometry.width * this.zoom}px`;
      canvas.style.height = `${geometry.height * this.zoom}px`;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(geometry.width * this.zoom * ratio);
      canvas.height = Math.round(geometry.height * this.zoom * ratio);
    });
    this.pages.style.gap = `${this.layout.page.gap * this.zoom}px`;
    this.syncInput(); this.paint(); this.onSelection();
  }
  printSheets() {
    this.finishComposition();
    const sheets = this.layout.pages.map(geometry => {
      const canvas = document.createElement('canvas');
      canvas.className = 'document-page';
      canvas.style.width = `${geometry.width}px`; canvas.style.height = `${geometry.height}px`;
      canvas.width = Math.round(geometry.width * 2); canvas.height = Math.round(geometry.height * 2);
      return canvas;
    });
    this.paint({ canvases: sheets, printing: true });
    return sheets;
  }
  paint({ canvases = this.canvases, printing = false } = {}) {
    if (this.destroyed || !this.layout) return;
    const [start, end] = this.model.range;
    const rects = selectionRects(this.selectionLayout, start, end);
    const owned = this.model.selection.controlCaret?.side === 'inside' && start === end && !this.accessible && document.activeElement === this.input
      ? inlineControlCaret(this.model.paragraphs, start, this.model.selection.controlCaret) : null;
    const controlRects = owned && !owned.control.hiddenAppearance ? owned.start === owned.end
      ? [{ ...caretRect(this.selectionLayout, owned.start, this.caretAffinity, this.caretPage), empty: true }]
      : selectionRects(this.selectionLayout, owned.start, owned.end) : null;
    const caret = caretRect(this.selectionLayout, this.model.selection.focus, this.caretAffinity, this.caretPage);
    for (let index = 0; index < canvases.length; index++) {
      const canvas = canvases[index], ctx = canvas.getContext('2d'), geometry = this.layout.pages[index] || this.layout.page;
      setCanvasFontAlternatives(ctx, this.model.styles.fontAlternatives);
      const scale = canvas.width / geometry.width;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = geometry.background || '#FFFFFF'; ctx.fillRect(0, 0, geometry.width, geometry.height);
      paintPagePictureBackground(ctx, geometry, this.images, { bestEffort: this.readOnly });
      ctx.fillStyle = '#000000';
      for (const separator of this.layout.columnSeparators || []) if (separator.page === index) ctx.fillRect(separator.x, separator.y, separator.width, separator.height);
      const sectionPage = geometry.pageBorders ? index - (this.layout.pageSections?.indexOf(this.layout.pageSections[index]) ?? 0) : 0;
      const pageBorders = pageBorderStrokes(this.storyLayout.borderMargins?.[index] ? { ...geometry, ...this.storyLayout.borderMargins[index] } : geometry, sectionPage);
      if (geometry.pageBorders?.zOrder === 'back') for (const border of pageBorders) paintParagraphBorder(ctx, border);
      // Header/footer stories paint beneath the body. Front/behind text
      // and relative drawing order apply within each story, not across them.
      for (const pageStory of [true, false]) {
        const floatingObjects = pageStory ? this.storyLayout.floatingObjects : this.layout.floatingObjects || [];
        const paintFloating = behind => {
          for (const f of floatingObjects) if (f.page === index && !!f.image.anchor.behind === behind) {
            if (f.cellClip) { ctx.save(); ctx.beginPath(); ctx.rect(f.cellClip.left ?? 0, f.cellClip.top, (f.cellClip.right ?? geometry.width) - (f.cellClip.left ?? 0), f.cellClip.bottom - f.cellClip.top); ctx.clip(); }
            const angle = normalizedRotation(f.image.rotation);
            if (angle) {
              ctx.save(); ctx.translate(f.x + f.width / 2, f.y + f.height / 2);
              ctx.rotate(angle / ANGLE_PER_DEGREE * Math.PI / 180);
              ctx.translate(-f.x - f.width / 2, -f.y - f.height / 2);
            }
            const bitmap = this.images.get(f.image.assetId);
            if (bitmap) {
              if (f.image.opacity !== undefined) { ctx.save(); ctx.globalAlpha *= f.image.opacity; }
              const { flipH, flipV } = f.image, cropped = !bitmap.previewPlaceholder && f.image.crop && Object.values(f.image.crop).some(Boolean);
              if (flipH || flipV || cropped) {
                ctx.save();
                ctx.translate(f.x + (flipH ? f.width : 0), f.y + (flipV ? f.height : 0));
                ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
                // Crop the source viewport, leaving negative crop outsets clear.
                // The anchor/wrapping frame stays fixed, including under flips.
                const rect = imageCropRect(bitmap.previewPlaceholder ? undefined : f.image.crop, bitmap.width, bitmap.height);
                if (rect) {
                  const [x, y, w, h] = rect.destination;
                  const [sx, sy, sw, sh] = rect.source, scaleX = w * f.width / sw, scaleY = h * f.height / sh;
                  ctx.beginPath(); ctx.rect(x * f.width, y * f.height, w * f.width, h * f.height); ctx.clip();
                  paintDecodedImage(ctx, bitmap, x * f.width - sx * scaleX, y * f.height - sy * scaleY, bitmap.width * scaleX, bitmap.height * scaleY, { ...drawingPageContext(this.drawingPageContexts, index, f.pageStory ? undefined : f.region), pageStory: !!f.pageStory });
                }
                ctx.restore();
              } else paintDecodedImage(ctx, bitmap, f.x, f.y, f.width, f.height, { ...drawingPageContext(this.drawingPageContexts, index, f.pageStory ? undefined : f.region), pageStory: !!f.pageStory });
              if (f.image.opacity !== undefined) ctx.restore();
            }
            if (this.session.path === null && !f.pageStory && start < f.end && end > f.start) { ctx.fillStyle = 'rgba(55,95,145,.25)'; ctx.fillRect(f.x, f.y, f.width, f.height); }
            if (angle) ctx.restore();
            if (f.cellClip) ctx.restore();
          }
        };
        paintFloating(true);
        const paintedCells = pageStory ? this.storyLayout.cells : this.layout.cells;
        for (const cell of paintedCells) if (cell.page === index) {
          if (cell.fill) {
            // Row boxes use border centerlines; shading fills between the leading
            // horizontal ink edges, including a wider border in a neighboring cell.
            const top = Math.max(cell.y - (cell.borderInsets?.top || 0) + (cell.fillTopInset || 0), cell.cellClip?.top ?? -Infinity);
            const bottom = Math.min(cell.y + cell.height - (cell.borderInsets?.bottom || 0) - (cell.fillBottomInset || 0), cell.cellClip?.bottom ?? Infinity);
            const left = Math.max(cell.x, cell.cellClip?.left ?? -Infinity), right = Math.min(cell.x + cell.width, cell.cellClip?.right ?? Infinity);
            ctx.fillStyle = cell.fill; if (bottom > top && right > left) ctx.fillRect(left, top, right - left, bottom - top);
          }
        }
        const pageLines = (pageStory ? this.storyLayout.lines : [...this.layout.lines, ...(this.layout.repeatedLines || [])]).filter(line => line.page === index);
        const backgrounds = paragraphBackgrounds(pageLines, geometry, paintedCells);
        const paragraphBorders = (pageStory ? this.storyLayout.borders : this.layout.paragraphBorders || []).filter(border => border.page === index);
        const paintedParagraphInk = paintParagraphBackgrounds(ctx, new Set([...backgrounds.values()].map(value => value.rect).filter(Boolean)), paragraphBorders);
        const tableBorders = deviceTableBorders(ctx, (pageStory ? this.storyLayout.tableBorders : this.layout.tableBorders).filter(stroke => stroke.page === index));
        for (const guide of printing ? [false] : [true, false]) for (const stroke of tableBorders) if (stroke.guide === guide) paintTableBorder(ctx, stroke);
        for (const border of paragraphBorders) paintParagraphBorder(ctx, border, paintedParagraphInk.get(border));
        // Run backgrounds precede selection and glyphs, including repeated headers.
        const surfaceGeometry = geometry;
        for (const physical of pageLines) {
          const { rect, base } = backgrounds.get(physical);
          paintOnParagraphBackground(ctx, rect, geometry, base, background => {
            ctx.save();
            const { line, geometry } = enterCellText(ctx, physical, surfaceGeometry);
            if (line.clip) { ctx.beginPath(); ctx.rect(0, line.y, geometry.width, line.height); ctx.clip(); }
            if (line.cellClip) { ctx.beginPath(); ctx.rect(line.cellClip.left ?? 0, line.cellClip.top, (line.cellClip.right ?? geometry.width) - (line.cellClip.left ?? 0), line.cellClip.bottom - line.cellClip.top); ctx.clip(); }
            if (line.textClip) { ctx.beginPath(); ctx.rect(line.textClip.left, 0, line.textClip.right - line.textClip.left, geometry.height); ctx.clip(); }
            const spans = [...(line.backgrounds || []), ...(line.marker && hasRunBackground(line.marker) ? [line.marker] : [])];
            for (const span of spans) {
              const band = runBackgroundRect(line, span);
              ctx.fillStyle = runBackground(span, background); ctx.fillRect(band.x, band.y, band.width, band.height);
            }
            ctx.restore();
          });
        }
        ctx.fillStyle = 'rgba(55,105,180,.28)';
        if (!printing && pageStory === (this.session.path !== null)) for (const r of rects) if (r.page === index) ctx.fillRect(r.x, r.y, r.width, r.height);
        ctx.fillStyle = '#000000'; ctx.textBaseline = 'alphabetic';
        // Inline drawing ink paints over surrounding paragraph glyphs,
        // including ink extending outside the drawing's layout rectangle.
        const inlinePictureLines = pageLines.filter(line => line.fragments.some(fragment => fragment.image && !isPositionedImage(fragment.image)));
        for (const imagesOnly of [false, true]) for (const physical of imagesOnly ? inlinePictureLines : pageLines) {
          const { rect, base } = backgrounds.get(physical);
          paintOnParagraphBackground(ctx, rect, geometry, base, background => {
            ctx.save();
            const { line, geometry } = enterCellText(ctx, physical, surfaceGeometry);
            if (line.clip && line.clipText !== false) { ctx.beginPath(); ctx.rect(0, line.y, geometry.width, line.height); ctx.clip(); }
            if (line.cellClip) { ctx.beginPath(); ctx.rect(line.cellClip.left ?? 0, line.cellClip.top, (line.cellClip.right ?? geometry.width) - (line.cellClip.left ?? 0), line.cellClip.bottom - line.cellClip.top); ctx.clip(); }
            if (line.textClip) { ctx.beginPath(); ctx.rect(line.textClip.left, 0, line.textClip.right - line.textClip.left, geometry.height); ctx.clip(); }
            if (!imagesOnly && line.marker) {
              const marker = line.marker; ctx.fillStyle = paintColor(marker.color, foregroundBackground(marker, background)); setCanvasTextStyle(ctx, marker); paintTextShadows(ctx, marker, line.baseline); paintText(ctx, marker, line.baseline);
              for (const u of marker.underlines || []) { ctx.fillStyle = paintColor(u.color, foregroundBackground(u, background)); paintUnderline(ctx, { ...u, x: u.x + marker.x }, line.baseline); }
            }
            for (const leader of imagesOnly ? [] : line.leaders || []) {
              ctx.save(); ctx.beginPath(); ctx.rect(leader.x, line.clipText === false ? 0 : line.y, leader.width, line.clipText === false ? geometry.height : line.height); ctx.clip();
              ctx.fillStyle = paintColor(leader.color, foregroundBackground(leader, background));
              setCanvasTextStyle(ctx, leader); paintTextShadows(ctx, leader, line.baseline); paintText(ctx, leader, line.baseline); ctx.restore();
            }
            for (const fragment of line.fragments) {
              if (!!fragment.image !== imagesOnly) continue;
              if (isPositionedImage(fragment.image)) continue;
              if (fragment.image) {
                const clipImage = line.clip && line.clipText === false || !!normalizedRotation(fragment.image.rotation);
                if (clipImage) { ctx.save(); ctx.beginPath(); ctx.rect(0, line.y, geometry.width, line.height); ctx.clip(); }
                const upright = fragment.uprightImage;
                if (upright) { ctx.save(); leaveCellText(ctx, physical.cellText.matrix); }
                const bitmap = this.images.get(fragment.image.assetId), top = upright?.y ?? line.baseline - fragment.ascent;
                if (bitmap) {
                  if (fragment.image.opacity !== undefined) { ctx.save(); ctx.globalAlpha *= fragment.image.opacity; }
                  const { flipH, flipV } = fragment.image, angle = normalizedRotation(fragment.image.rotation), transformed = flipH || flipV || angle;
                  const {x: x0, y: y0, width, height} = inlineImagePaintFrame(fragment.image, upright?.x ?? fragment.x, top);
                  if (transformed) {
                    ctx.save(); ctx.translate(x0 + width / 2, y0 + height / 2);
                    if (angle) ctx.rotate(angle / ANGLE_PER_DEGREE * Math.PI / 180);
                    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
                  }
                  const left = transformed ? -width / 2 : x0, upper = transformed ? -height / 2 : y0;
                  if (bitmap.previewPlaceholder || !fragment.image.crop || !Object.values(fragment.image.crop).some(Boolean)) paintDecodedImage(ctx, bitmap, left, upper, width, height, { ...drawingPageContext(this.drawingPageContexts, index, line.pageStory ? undefined : line.region), pageStory: !!line.pageStory });
                  else {
                    const rect = imageCropRect(fragment.image.crop, bitmap.width, bitmap.height);
                    if (rect) { const [x, y, w, h] = rect.destination; paintImage(ctx, bitmap, ...rect.source, left + x * width, upper + y * height, w * width, h * height); }
                  }
                  if (transformed) ctx.restore();
                  if (fragment.image.opacity !== undefined) ctx.restore();
                }
                if (this.session.path === null && !line.pageStory && start < fragment.end && end > fragment.start) {
                  const box = normalizedRotation(fragment.image.rotation)
                    ? positionedImageBounds(inlineImagePaintFrame(fragment.image, upright?.x ?? fragment.x, top))
                    : {x:upright?.x ?? fragment.x,y:top,width:upright?.width ?? fragment.width,height:upright?.height ?? fragment.ascent};
                  ctx.save(); ctx.fillStyle = 'rgba(55,95,145,.25)'; ctx.fillRect(box.x, box.y, box.width, box.height); ctx.restore();
                }
                if (upright) ctx.restore();
                if (clipImage) ctx.restore();
              } else {
                setCanvasTextStyle(ctx, fragment);
                paintTextShadows(ctx, fragment, line.baseline);
                const colors = fragment.colors || [{ value: fragment.color }];
                colors.forEach((span, i) => {
                  ctx.save(); ctx.fillStyle = paintColor(span.value, foregroundBackground(span, background));
                  if (colors.length > 1) {
                    // Paint the same shaped text through adjacent color windows.
                    // Color boundaries must not break kerning or ligature shaping.
                    const left = i ? fragment.x + span.x : 0;
                    const right = i < colors.length - 1 ? fragment.x + span.x + span.width : geometry.width;
                    ctx.beginPath(); ctx.rect(left, 0, right - left, geometry.height); ctx.clip();
                  }
                  paintText(ctx, Object.hasOwn(span, 'textOutline') ? { ...fragment, textOutline: span.textOutline, textFill: span.textFill ?? null, text3d: span.text3d ?? null, textScene: span.textScene ?? null } : fragment, line.baseline); ctx.restore();
                });
              }
            }
            for (const u of imagesOnly ? [] : line.underlines) { ctx.fillStyle = paintColor(u.color, foregroundBackground(u, background)); paintUnderline(ctx, u, line.baseline); }
            for (const u of imagesOnly ? [] : [...(line.strikes || []), ...(line.marker ? strikeSpans(line.marker, line.marker, line.marker.x, line.marker.width) : [])]) { ctx.fillStyle = paintColor(u.color, foregroundBackground(u, background)); ctx.fillRect(u.x, line.baseline + u.offset, u.width, u.thickness); }
            ctx.restore();
          });
        }
        paintFloating(false);
      }
      if (geometry.pageBorders?.zOrder !== 'back') for (const border of pageBorders) paintParagraphBorder(ctx, border);
      if (!printing && controlRects) paintControlCarets(ctx, controlRects, index, scale);
      if (!printing && start === end && caret.page === index && document.activeElement === this.input && !this.accessible) {
        ctx.fillStyle = '#375f91'; ctx.fillRect(caret.x, caret.y, caret.width ?? 1.5, caret.height);
      }
    }
    if (!printing) { this.positionInput(caret); this.imageInteraction?.update(); }
  }
  positionInput(caret) {
    if (this.accessible) return;
    const canvas = this.canvases[caret.page];
    if (!canvas) return;
    // Keep the native composition candidate window near the drawn caret.
    this.input.style.left = `${canvas.offsetLeft + caret.x * this.zoom}px`;
    this.input.style.top = `${canvas.offsetTop + caret.y * this.zoom}px`;
    this.input.style.height = `${caret.height * this.zoom}px`;
  }
  get inputText() { return this.model.text.replace(/[\v\f\u000e]/g, '\n'); }
  syncInput() {
    if (this.composition) return;
    if (this.input.value !== this.inputText) this.input.value = this.inputText;
    const [start, end] = this.model.range;
    const direction = this.model.selection.focus < this.model.selection.anchor ? 'backward' : 'forward';
    if (this.input.selectionStart !== start || this.input.selectionEnd !== end || this.input.selectionDirection !== direction) this.input.setSelectionRange(start, end, direction);
  }
  nativeSelection() {
    if (this.composition || this.input.value !== this.inputText) return;
    const a = this.input.selectionStart, b = this.input.selectionEnd;
    const backward = this.input.selectionDirection === 'backward';
    const anchor = backward ? b : a, focus = backward ? a : b;
    if (anchor === this.model.selection.anchor && focus === this.model.selection.focus) return;
    this.caretAffinity = 'forward'; this.caretPage = null; this.preferredX = null;
    this.model.select(anchor, focus); this.syncInput(); this.paint(); this.onSelection();
  }
  openHyperlink(link = this.model.hyperlink?.link) {
    if (!link) return;
    if (internalHyperlink(link)) { this.goToBookmark(this.model.bookmarks.find(b => b.name === link.anchor)?.id); return; }
    if (link.history) this.visitedLinks.add(link.target);
    this.onOpenLink(link.target);
  }
  setHyperlink(target, text) { this.execute(() => this.model.setHyperlink(target, text)); this.focus(); }
  removeHyperlink() { this.execute(() => this.model.removeHyperlink()); this.focus(); }
  get bookmarks() { return this.model.bookmarks.map(b => ({ id: b.id, name: b.name, start: b.start, end: b.end, page: lineAtPosition(this.selectionLayout, b.columnRange?.target ?? b.start, 'forward').page + 1 })); }
  addBookmark(name) { return this.execute(() => this.model.addBookmark(name)); }
  renameBookmark(id, name) { return this.execute(() => this.model.renameBookmark(id, name)); }
  removeBookmark(id) { return this.execute(() => this.model.removeBookmark(id)); }
  goToBookmark(id) {
    this.finishComposition(); const bookmark = this.model.bookmarks.find(b => b.id === id);
    this.model.select(bookmark?.columnRange?.target ?? bookmark?.start ?? 0);
    this.caretAffinity = 'forward'; this.caretPage = null; this.preferredX = null;
    this.focus(); this.revealCaret(); this.onSelection(); return true;
  }
  point(event, updateCaret = true) {
    // Coordinates remain in page units across zoom, scroll, and display scaling.
    const nearest = this.canvases.reduce((best, canvas) => {
      const r = canvas.getBoundingClientRect();
      const distance = Math.max(r.top - event.clientY, 0, event.clientY - r.bottom);
      return !best || distance < best.distance ? { canvas, r, distance } : best;
    }, null);
    if (!nearest) return 0;
    const page = Number(nearest.canvas.dataset.page), y = (event.clientY - nearest.r.top) / this.zoom;
    this.pointImage = imageAtPoint(this.selectionLayout, page, (event.clientX - nearest.r.left) / this.zoom, y, { includeBehindText: !!event.altKey });
    const hit = hitTestStop(this.selectionLayout, page, (event.clientX - nearest.r.left) / this.zoom, y), position = hit.offset;
    this.pointLink = hyperlinkAtPoint(this.selectionLayout, this.model.paragraphs, page, (event.clientX - nearest.r.left) / this.zoom, y, this.pointImage);
    if (!updateCaret) return position;
    this.caretPage = page;
    const prior = lineAtPosition(this.selectionLayout, position, 'backward', page);
    this.caretAffinity = prior.page === page && position === prior.end && Math.abs(prior.y + prior.height / 2 - y) <= prior.height / 2 ? 'backward' : 'forward';
    if (prior.wrapSegments && prior.page === page && y >= prior.y && y <= prior.y + prior.height) {
      const stop = nearestStop(prior, (event.clientX - nearest.r.left) / this.zoom);
      if (stop.offset === position && prior.wrapSegments.some(s => s.stops.at(-1) === stop)) this.caretAffinity = 'backward';
    }
    if (hit.affinity) this.caretAffinity = hit.affinity;
    return position;
  }
  controlPointerCaret(e, position, caret) {
    if (!caret || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || position !== this.model.text.length) return caret;
    // At the story end, an outside position is exposed in the blank area
    // past the final text. An internal paragraph end has no such pointer stop.
    const line = lineAtPosition(this.selectionLayout, position, this.caretAffinity, this.caretPage);
    const canvas = this.canvases[line.page], rect = canvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) / this.zoom;
    if (line.cellText) x = cellTextLocalPoint(line.cellText.matrix, x, (e.clientY - rect.top) / this.zoom).x;
    const local = line.cellText?.line || line, edge = local.stops.reduce((right, s) => Math.max(right, s.x), -Infinity);
    return x > edge && local.stops.some(s => s.offset === position && s.x === edge) ? { ...caret, side: 'after' } : caret;
  }
  pointerDown(e) {
    if (e.button !== 0 || this.composition) return;
    e.preventDefault();
    if (this.session.path !== null) {
      const story = this.storyAtEvent(e);
      if (story && this.pageStories.stories[story.pageStory].editable && (story.pageStory !== this.session.path || story.page !== this.storyPage)) this.editStory(story.pageStory, story.page);
    }
    let position = this.point(e), restoredPromptSelection, restoredOutsideCaret, sameOffsetCaret;
    if ((e.ctrlKey || e.metaKey) && this.pointLink) { this.openHyperlink(this.pointLink.link); return; }
    const selection = this.model.selection;
    if (!this.readOnly && !e.shiftKey && selection.anchor === selection.focus && selection.controlCaret?.side === 'inside') {
      const range = inlineControlCaret(this.model.paragraphs, selection.focus, selection.controlCaret);
      if (range && range.start === range.end && position === range.start) sameOffsetCaret = this.controlPointerCaret(e, position, selection.controlCaret);
      if (range && range.start === range.end && (position !== range.start || sameOffsetCaret?.side === 'after')) {
        const { scrollTop, scrollLeft } = this.host;
        const extendPrompt = !e.ctrlKey && !e.metaKey && !e.altKey;
        const word = extendPrompt && new Intl.Segmenter(undefined, { granularity: 'word' }).segment(this.model.text).containing(Math.max(0, position - 1));
        const targetEnd = word?.isWordLike ? word.index + word.segment.length : position;
        if (!this.execute(() => this.model.leaveEmptyControl(position < range.start ? 'before' : 'after'))) return;
        const exited = this.model.selection;
        // Restoring a glossary prompt can wrap lines. Hit the physical pointer
        // again after layout, without letting revealCaret move its target.
        this.host.scrollTop = scrollTop; this.host.scrollLeft = scrollLeft;
        position = this.point(e);
        sameOffsetCaret = undefined;
        if (extendPrompt && position === exited.focus) restoredOutsideCaret = exited.controlCaret;
        const prompt = this.model.placeholderAt(position);
        if (extendPrompt && prompt?.control.id === range.control.id) {
          // The first exit click extends through the original target word,
          // mapped across restoration. Do not consume the rest of its line
          // or paragraph; later ordinary clicks select only the prompt.
          restoredPromptSelection = [prompt.start, Math.max(prompt.end, targetEnd + prompt.end - range.start)];
        }
      }
    }
    if (this.pointImage && !e.shiftKey) { this.model.select(this.pointImage.start, this.pointImage.end); if (this.imageInteraction.begin(e)) { this.onSelection(); return; } }
    else if (restoredPromptSelection) this.model.select(...restoredPromptSelection);
    else if (!e.shiftKey && (this.model.macroButtonAt(position)||this.model.placeholderAt(position))) { const range = this.model.macroButtonAt(position)||this.model.placeholderAt(position); this.model.select(range.start, range.end); }
    else {
      const caret = !e.shiftKey ? restoredOutsideCaret || sameOffsetCaret || emptyControlPointerCaret(this.model.paragraphs, position, this.model.selection.controlCaret) : undefined;
      this.model.select(e.shiftKey ? this.model.selection.anchor : position, position,
        caret && !restoredOutsideCaret && !sameOffsetCaret ? this.controlPointerCaret(e, position, caret) : caret);
    }
    const dragSelection = this.model.selection;
    const dragRange = !this.readOnly && !e.shiftKey && dragSelection.anchor === dragSelection.focus &&
      dragSelection.controlCaret?.side === 'inside' && inlineControlCaret(this.model.paragraphs, position, dragSelection.controlCaret);
    this.dragControl = dragRange && dragRange.start === dragRange.end
      ? { position, caret: dragSelection.controlCaret, model: this.model, revision: this.session.revision } : null;
    this.dragging = true;
    this.pages.setPointerCapture(e.pointerId);
    this.preferredX = null;
    this.focus(); this.onSelection();
  }
  pointerMove(e) {
    if (this.imageInteraction.move(e)) return;
    if (!this.dragging) {
      this.point(e, false);
      this.pages.title = this.pointLink ? `${this.pointLink.link.tooltip || hyperlinkLabel(this.pointLink.link)} (Ctrl/Cmd+click to open)` : '';
      this.pages.style.cursor = this.pointLink && (e.ctrlKey || e.metaKey) ? 'pointer' : '';
      return;
    }
    const position = this.point(e), selection = this.model.selection;
    this.model.select(selection.anchor, position,
      position === selection.anchor && this.dragControl?.position === position &&
      this.dragControl.model === this.model && this.dragControl.revision === this.session.revision ? this.dragControl.caret : undefined);
    this.syncInput(); this.paint(); this.onSelection();
    const bounds = this.host.getBoundingClientRect();
    if (e.clientY > bounds.bottom - 30) this.host.scrollTop += 20;
    else if (e.clientY < bounds.top + 30) this.host.scrollTop -= 20;
  }
  pointerUp(e) {
    if (this.imageInteraction.end(e)) return;
    const control = this.dragControl, wasDragging = this.dragging;
    this.dragging = false; this.dragControl = null;
    if (!wasDragging || !control || this.readOnly || this.composition ||
      control.model !== this.model || control.revision !== this.session.revision) return;
    const position = this.point(e);
    if (position === control.position && this.controlPointerCaret(e, position, control.caret)?.side !== 'after') return;
    // A completed drag out of an empty persistent wrapper restores its prompt.
    // Its zero-length owner must survive the temporary drag selection, and the
    // release point must be tested again after the restored prompt reflows.
    const { scrollTop, scrollLeft } = this.host;
    const extendPrompt = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const word = extendPrompt && new Intl.Segmenter(undefined, { granularity: 'word' }).segment(this.model.text).containing(Math.max(0, position - 1));
    const targetEnd = word?.isWordLike ? word.index + word.segment.length : position;
    this.model.select(control.position, control.position, control.caret);
    if (!this.execute(() => this.model.leaveEmptyControl(position < control.position ? 'before' : 'after'))) return;
    const exited = this.model.selection;
    this.host.scrollTop = scrollTop; this.host.scrollLeft = scrollLeft;
    const target = this.point(e), placeholder = this.model.placeholderAt(target);
    if (this.pointImage) this.model.select(this.pointImage.start, this.pointImage.end);
    else if (placeholder) {
      // As with an exit click, release inside the restored owner selects
      // through the originally targeted word, not the rest of its line.
      const end = extendPrompt && placeholder.control.id === control.caret.id
        ? Math.max(placeholder.end, targetEnd + placeholder.end - control.position) : placeholder.end;
      this.model.select(placeholder.start, end);
    }
    else this.model.select(target, target, extendPrompt && target === exited.focus ? exited.controlCaret : undefined);
    this.syncInput(); this.paint(); this.onSelection();
  }
  storyAtEvent(e, preferBody = this.session.path === null) {
    // Pointer capture retargets the double-click to the pages container.
    const canvas = this.canvases.find(canvas => { const r = canvas.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
    if (canvas) {
      const rect = canvas.getBoundingClientRect(), page = Number(canvas.dataset.page);
      const x = (e.clientX - rect.left) / this.zoom, y = (e.clientY - rect.top) / this.zoom;
      return pageStoryAtPoint(this.layout, this.storyLayout, page, x, y, preferBody);
    }
  }
  selectWord(e) {
    if (!this.readOnly) {
      const storyLine = this.storyAtEvent(e, true);
      if (storyLine && this.pageStories.stories[storyLine.pageStory].editable) this.editStory(storyLine.pageStory, storyLine.page);
      else if (this.session.path !== null) this.editStory(null);
    }
    const pos = this.point(e);
    if (this.pointImage) {
      this.model.select(this.pointImage.start, this.pointImage.end); this.focus(); this.onSelection(); return;
    }
    const words = new Intl.Segmenter(undefined, { granularity: 'word' });
    const word = [...words.segment(this.model.text)].find(s => s.index <= pos && pos < s.index + s.segment.length);
    if (word) { this.model.select(word.index, word.index + word.segment.length); this.focus(); this.onSelection(); }
  }
  revealCaret() {
    if (this.accessible) return;
    const caret = caretRect(this.selectionLayout, this.model.selection.focus, this.caretAffinity, this.caretPage), canvas = this.canvases[caret.page];
    const top = canvas.offsetTop + caret.y * this.zoom;
    if (top < this.host.scrollTop + 12) this.host.scrollTop = Math.max(0, top - 24);
    if (top + caret.height * this.zoom > this.host.scrollTop + this.host.clientHeight - 12) this.host.scrollTop = top + caret.height * this.zoom - this.host.clientHeight + 24;
  }
  move(key, shift, word, mod) {
    // Arrow keys follow the physical reading axis. The reference Selection.MoveUp/
    // MoveDown APIs do not perform this keyboard dispatch for rotated cells.
    const currentLine = ['ArrowUp', 'ArrowDown'].includes(key) || this.selectionLayout.hasRotatedCells && ['ArrowLeft', 'ArrowRight'].includes(key)
      ? lineAtPosition(this.selectionLayout, this.model.selection.focus, this.caretAffinity, this.caretPage) : null;
    const rotatedCrossLine = currentLine?.cellText && ['ArrowLeft', 'ArrowRight'].includes(key);
    const preferredCellId = rotatedCrossLine ? currentLine.cellId : null;
    if (this.preferredCellId !== preferredCellId) this.preferredX = null;
    this.preferredCellId = preferredCellId;
    if (rotatedCrossLine) {
      const forward = (key === 'ArrowRight' ? 1 : -1) === currentLine.cellText.matrix[2];
      key = forward ? 'ArrowDown' : 'ArrowUp';
    } else if (currentLine?.cellText) {
      const forward = (key === 'ArrowDown' ? 1 : -1) === currentLine.cellText.matrix[1];
      key = forward ? 'ArrowRight' : 'ArrowLeft';
    }
    if (!['ArrowUp', 'ArrowDown'].includes(key)) this.preferredX = null;
    const { focus, anchor } = this.model.selection;
    let target = focus, affinity = key === 'End' ? 'backward' : 'forward';
    const [start, end] = this.model.range;
    if (!shift && start !== end && ['ArrowLeft', 'ArrowRight'].includes(key)) target = key === 'ArrowLeft' ? start : end;
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const direction = key === 'ArrowLeft' ? -1 : 1;
      const stops = word ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(this.model.text)].filter(s => s.isWordLike).flatMap(s => [s.index, s.index + s.segment.length]).concat([0, this.model.text.length]).sort((a, b) => a - b) : boundaries(this.model.text);
      target = direction < 0 ? [...stops].reverse().find(p => p < focus) ?? 0 : stops.find(p => p > focus) ?? this.model.text.length;
      target = this.model.promptBoundary(target,direction);
      this.preferredX = null;
    } else {
      const line = currentLine || lineAtPosition(this.selectionLayout, focus, this.caretAffinity, this.caretPage);
      if (key === 'Home') target = mod ? 0 : line.start;
      if (key === 'End') target = mod ? this.model.text.length : line.end;
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const readingLayout = rotatedCrossLine ? { page: { width: Infinity }, lines: [{ ...line.cellText.line, page: 0 }] } : this.selectionLayout;
        this.preferredX ??= caretRect(readingLayout, focus, this.caretAffinity, rotatedCrossLine ? null : this.caretPage).x;
        const next = verticalLine(this.selectionLayout, line, key === 'ArrowUp' ? -1 : 1, this.preferredX);
        if (next) this.preferredX += (next.columnOffset || 0) - (line.columnOffset || 0);
        const nextStop = next ? nearestStop(rotatedCrossLine ? next.cellText.line : next, this.preferredX) : null;
        target = nextStop ? nextStop.offset
          : rotatedCrossLine ? (key === 'ArrowUp' ? line.start : line.end) : key === 'ArrowUp' ? 0 : this.model.text.length;
        affinity = next && target === next.end ? 'backward' : 'forward';
        if (next?.wrapSegments?.some(s => s.stops.at(-1) === nextStop)) affinity = 'backward';
        if (nextStop?.affinity) affinity = nextStop.affinity;
        this.caretPage = next?.page ?? null;
      }
    }
    this.caretAffinity = affinity;
    if (mod && ['Home', 'End'].includes(key)) this.caretPage = null;
    let controlMove = null;
    if (shift && !word && !this.readOnly && this.model.hasPersistentControls && ['ArrowLeft', 'ArrowRight'].includes(key) && anchor === focus) {
      const selection = this.model.selection, direction = key === 'ArrowLeft' ? -1 : 1;
      const owner = selection.controlCaret?.side === 'inside' && inlineControlCaret(this.model.paragraphs, focus, selection.controlCaret);
      // Crossing an SDT boundary consumes a selection step before selecting
      // adjacent text, even when the control itself has nonempty contents.
      // Reversing that step returns to the same inside caret.
      if (owner && (owner.start === owner.end || focus === (direction < 0 ? owner.start : owner.end) || selection.controlSelection)) {
        const extent = selection.controlSelection;
        if (!extent || extent.direction !== direction) {
          // Reversing an adjacent-boundary step returns to the original
          // wrapper's boundary before reversing its first outward step.
          this.model.select(anchor, focus, extent?.adjacent ? { id: extent.id, side: 'inside' } : selection.controlCaret,
            !extent ? { id: owner.control.id, direction } : extent.adjacent ? { id: extent.id, direction: extent.direction } : undefined);
          this.syncInput(); this.paint(); this.onSelection(); return;
        }
        if (owner.start === owner.end) {
          this.execute(() => {
            this.model.leaveEmptyControl(direction < 0 ? 'before' : 'after', target);
            this.model.select(anchor, this.model.selection.focus, undefined, extent);
          });
          this.onSelection(); return;
        }
        if (!extent.adjacent) {
          const next = adjacentInlineControl(this.model.paragraphs, owner, direction);
          if (next) {
            // The neighboring SDT adds another zero-width stop. Backward
            // replacement at that junction uses its preceding wrapper.
            this.model.select(anchor, focus, direction < 0 ? { id: next.control.id, side: 'inside' } : selection.controlCaret,
              { ...extent, adjacent: next.control.id });
            this.syncInput(); this.paint(); this.onSelection(); return;
          }
        }
      }
    }
    if (!shift && this.model.hasPersistentControls) {
      if (!word && ['ArrowLeft', 'ArrowRight'].includes(key))
        controlMove = moveInlineControlCaret(this.model.paragraphs, this.model.selection, target, key === 'ArrowLeft' ? -1 : 1);
      else if (!this.readOnly && ['Home', 'End'].includes(key))
        controlMove = moveInlineControlHomeEnd(this.model.paragraphs, this.model.selection, target, key === 'Home' ? -1 : 1);
    }
    if (controlMove?.restoreEmpty && !this.readOnly) {
      const ok = this.execute(() => this.model.leaveEmptyControl(controlMove.controlCaret.side, controlMove.destination));
      if (ok && key === 'End') { this.caretAffinity = affinity; this.paint(); this.revealCaret(); }
      this.onSelection(); return;
    }
    let extent = shift ? this.model.selection.controlSelection : undefined;
    if (extent && !word && !this.readOnly && ['ArrowLeft', 'ArrowRight'].includes(key)) {
      const direction = key === 'ArrowLeft' ? -1 : 1;
      // Once the text selection has expanded, its focus still passes through
      // rich-text control boundary stops independently of the original anchor.
      const next = anchor !== focus ? moveInlineControlCaret(this.model.paragraphs,
        { anchor: focus, focus, controlCaret: extent.focusCaret }, target, direction) : null;
      if (next && !next.restoreEmpty) {
        target = next.focus;
        extent = { ...extent, focusCaret: next.controlCaret };
      } else {
        extent = { ...extent }; delete extent.focusCaret;
        const original = inlineControlCaret(this.model.paragraphs, anchor, { id: extent.id, side: 'inside' });
        const owner = original && adjacentInlineControl(this.model.paragraphs, original, direction);
        if (owner && owner.start < target && target < owner.end) extent.focusCaret = { id: owner.control.id, side: 'inside' };
      }
    }
    if (controlMove) this.model.select(controlMove.anchor, controlMove.focus, controlMove.controlCaret);
    else this.model.select(shift ? anchor : target, target,
      !shift && mod && key === 'Home' && this.model.hasPersistentControls ? documentStartControlCaret(this.model.paragraphs) : undefined, extent);
    this.syncInput(); this.paint(); this.revealCaret(); this.onSelection();
  }
  keydown(e) {
    if (e.isComposing || this.composition || e.keyCode === 229) return;
    if (e.key === 'F9' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault(); this.updatePageReferences(); return;
    }
    const leaveWithTab = e.key === 'Tab' && this.leaveWithTab;
    this.leaveWithTab = false;
    const mod = e.ctrlKey || e.metaKey, letter = e.code?.replace(/^Key/, '').toLowerCase() || e.key.toLowerCase();
    if (mod && !e.altKey && !e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
      e.preventDefault(); this.clearDirectTextFormatting(); return;
    }
    if (mod && !e.altKey && ['b', 'i', 'u', 'z', 'y', 's', 'a', 'k', 'j'].includes(letter)) {
      e.preventDefault();
      if (letter === 'b') this.toggleBold();
      if (letter === 'i') this.toggleItalic();
      if (letter === 'u') this.toggleUnderline();
      if (letter === 'z') e.shiftKey ? this.redo() : this.undo();
      if (letter === 'y') this.redo();
      if (letter === 's') this.onSave();
      if (letter === 'k' && !this.readOnly) this.onLink();
      if (letter === 'j') this.setParagraphFormat({ alignment: 'both' });
      if (letter === 'a') { this.model.select(0, this.model.text.length); this.syncInput(); this.paint(); this.onSelection(); }
      return;
    }
    if (e.altKey && e.shiftKey && !mod && ['ArrowLeft', 'ArrowRight'].includes(e.key) && this.model.selectedParagraphs.every(p => p.list)) {
      e.preventDefault(); this.changeListLevel(e.key === 'ArrowRight' ? 1 : -1); return;
    }
    if (e.key === 'Enter' && !e.altKey) {
      e.preventDefault(); this.execute(() => mod ? (e.shiftKey ? this.model.insertColumnBreak() : this.model.insertPageBreak()) : e.shiftKey ? this.model.replace('\v') : this.model.insertParagraph()); return;
    }
    // Escape then Tab leaves the editor; Shift+Tab also keeps normal focus navigation.
    if (e.key === 'Escape') { if (this.session.path !== null) { e.preventDefault(); this.editStory(null); } else this.leaveWithTab = true; return; }
    if (e.key === 'Tab' && !mod && !e.altKey && !leaveWithTab && this.model.tableContext) {
      e.preventDefault(); this.execute(() => this.model.moveCell(e.shiftKey ? -1 : 1)); return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !mod && !e.altKey && !leaveWithTab) {
      e.preventDefault(); this.insertTab(); return;
    }
    if (this.accessible) return; // Native textarea navigation in accessible text mode.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      if (e.metaKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) this.move(e.key === 'ArrowLeft' ? 'Home' : 'End', e.shiftKey, false, false);
      else this.move(e.key, e.shiftKey, e.altKey || e.ctrlKey, mod);
    } else if (['Backspace', 'Delete'].includes(e.key) && !mod && !e.altKey) {
      e.preventDefault(); this.execute(() => this.model.delete(e.key === 'Backspace' ? -1 : 1));
    }
  }
  beforeInput(e) {
    if (this.readOnly) { e.preventDefault(); return; }
    if (e.isComposing || this.composition || !e.cancelable) return;
    this.nativeSelection();
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); e.inputType === 'historyUndo' ? this.undo() : this.redo(); return; }
    const actions = {
      insertText: () => this.model.replace(e.data || ''),
      insertLineBreak: () => this.model.replace('\v'),
      insertParagraph: () => this.model.insertParagraph(),
      deleteContentBackward: () => this.model.delete(-1),
      deleteContentForward: () => this.model.delete(1),
      formatBold: () => this.model.toggleBold(),
      formatStrikeThrough: () => this.model.setRunFormat({ strikethrough: this.model.runFormatting.strikethrough === 'single' ? 'none' : 'single' }),
      formatItalic: () => this.model.toggleItalic(), formatUnderline: () => this.model.toggleUnderline(),
      formatJustifyFull: () => this.model.setParagraphFormat({ alignment: 'both' }),
      formatRemove: () => this.model.clearDirectTextFormatting(),
    };
    if (actions[e.inputType]) { e.preventDefault(); this.execute(actions[e.inputType]); }
  }
  reconcile(value, checkpoint) {
    const old = this.inputText;
    if (old === value) return false;
    const selection = this.model.selection, at = selection.focus, added = value.length - old.length;
    // Identical neighboring text makes a longest-prefix diff ambiguous. Keep an
    // insertion at its selected SDT boundary when the native value permits it.
    if (selection.controlCaret && selection.anchor === at && added > 0 &&
        value.slice(0, at) === old.slice(0, at) && value.slice(at + added) === old.slice(at)) {
      return this.model.replace(value.slice(at, at + added), { checkpoint });
    }
    let start = 0, end = old.length, tail = value.length;
    while (start < end && start < tail && old[start] === value[start]) start++;
    // Keep diffs at complete grapheme boundaries, including composed emoji.
    const points = boundaries(old);
    start = [...points].reverse().find(p => p <= start) ?? 0;
    while (end > start && tail > start && old[end - 1] === value[tail - 1]) { end--; tail--; }
    const safeEnd = points.find(p => p >= end) ?? old.length;
    tail += safeEnd - end; end = safeEnd;
    const typingFormat = this.model.typingFormat, typingStyle = this.model.typingStyle, typingDirectCleared = this.model.typingDirectCleared;
    const controlCaret = start === end && start === selection.anchor && end === selection.focus ? selection.controlCaret : undefined;
    const sameRange = start === Math.min(selection.anchor, selection.focus) && end === Math.max(selection.anchor, selection.focus);
    this.model.select(sameRange ? selection.anchor : start, sameRange ? selection.focus : end, controlCaret, sameRange ? selection.controlSelection : undefined);
    this.model.typingFormat = typingFormat; this.model.typingStyle = typingStyle; this.model.typingDirectCleared = typingDirectCleared;
    return this.model.replace(value.slice(start, tail), { checkpoint });
  }
  nativeInput() {
    if (this.readOnly) { this.syncInput(); return; }
    try {
      const revision = this.session.revision;
      this.session.run(() => {
        const value = this.input.value, a = this.input.selectionStart, b = this.input.selectionEnd;
        this.reconcile(value, false);
        const typingFormat = this.model.typingFormat, typingStyle = this.model.typingStyle, typingDirectCleared = this.model.typingDirectCleared;
        if (this.inputText === value) {
          const selection = this.model.selection;
          this.model.select(a, b, a === selection.anchor && b === selection.focus ? selection.controlCaret : undefined, a === selection.anchor && b === selection.focus ? selection.controlSelection : undefined);
        }
        this.model.typingFormat = typingFormat; this.model.typingStyle = typingStyle; this.model.typingDirectCleared = typingDirectCleared;
      }, () => { this.validateStory(); this.relayout(); this.revealCaret(); }, { record: !this.composition });
      if (!this.composition && revision !== this.session.revision) this.onChange();
    } catch (e) {
      if (this.composition) this.input.value = this.inputText;
      this.onError(e); this.relayout();
    }
  }
  finishComposition() {
    if (!this.composition) return;
    const before = this.composition;
    try { this.session.run(() => this.reconcile(this.input.value, false), () => this.validateStory(), { record: false }); }
    catch (e) { this.session.restore(before); this.onError(e); }
    this.composition = null;
    const changed = JSON.stringify(before.state.paragraphs) !== JSON.stringify(this.model.paragraphs);
    if (changed) this.session.record(before);
    this.relayout();
    if (changed) this.onChange();
  }
  copy(e, cut) {
    if (this.composition || !e.clipboardData) return;
    const [start, end] = this.model.range;
    if (start === end) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', this.model.clipboardText());
    if (cut) this.execute(() => this.model.replace(''));
  }
  destroy() { this.destroyed = true; this.abort.abort(); for (const image of this.images.values()) image.close?.(); this.images.clear(); this.host.replaceChildren(); }
}
