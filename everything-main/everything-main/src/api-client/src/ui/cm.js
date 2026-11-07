/**
 * CodeMirror 6 setup, loaded on demand (its own chunk) the first time an
 * editor is shown. Theme colors come from the app's CSS variables so light
 * and dark follow the app theme without reconfiguring editors.
 */
import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder as cmPlaceholder,
  MatchDecorator, ViewPlugin, Decoration, highlightSpecialChars,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import {
  bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle, codeFolding,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, search, openSearchPanel } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { xml } from '@codemirror/lang-xml';

const style = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--syn-key)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.tagName, t.typeName, t.className], color: 'var(--syn-tag)' },
  { tag: [t.attributeName], color: 'var(--syn-attr)' },
  { tag: [t.attributeValue], color: 'var(--syn-string)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-tag)' },
  { tag: [t.punctuation, t.bracket, t.separator], color: 'var(--syn-punct)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--text)', padding: '6px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important',
  },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-faint)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '36px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-hover) 55%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-muted)', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '0 4px' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)', outline: 'none' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--warning) 18%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warning) 30%, transparent)', outline: '1px solid var(--warning)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--bg-subtle)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: 'var(--font-ui)', fontSize: '12px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'var(--font-ui)', fontSize: '12px' },
  '.cm-textfield': { border: '1px solid var(--border-strong)', borderRadius: '4px', background: 'var(--surface)', color: 'var(--text)', padding: '2px 6px' },
  '.cm-button': { backgroundImage: 'none', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: '4px', color: 'var(--text)' },
  '.cm-tooltip': { border: '1px solid var(--overlay-border)', backgroundColor: 'var(--surface)', color: 'var(--text)', borderRadius: '6px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
  '.cm-var': { borderRadius: '3px', backgroundColor: 'var(--var-ok-bg)', color: 'var(--var-ok-text)' },
  '.cm-var.missing': { backgroundColor: 'var(--var-missing-bg)', color: 'var(--var-missing-text)' },
});

function languageExtension(lang) {
  switch (lang) {
    case 'json':
      return json();
    case 'javascript':
      return javascript();
    case 'html':
      return html();
    case 'xml':
      return xml();
    default:
      return [];
  }
}

/** Highlights {{variables}} inside the editor, colored by whether they resolve. */
function variableHighlighter(isDefined) {
  const deco = new MatchDecorator({
    regexp: /\{\{\s*([^{}\r\n]+?)\s*\}\}/g,
    decoration: (m) => Decoration.mark({ class: isDefined(m[1]) ? 'cm-var' : 'cm-var missing' }),
  });
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = deco.createDeco(view);
      }
      update(u) {
        this.decorations = u.docChanged || u.viewportChanged || u.transactions.some((tr) => tr.reconfigured) ? deco.createDeco(u.view) : deco.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// Mod+Alt+[ and ] switch tabs in the app (Cmd+Alt on macOS, Ctrl+Alt elsewhere), so the
// fold keys must not take them: folding the block at the cursor keeps Ctrl+Shift+[ and ]
// everywhere, and folding everything keeps Ctrl+Alt+[ and ] on macOS only.
const foldKeys = foldKeymap.map((k) => (k.mac?.startsWith('Cmd-Alt-') ? { ...k, mac: undefined } : k.key.startsWith('Ctrl-Alt-') ? { ...k, key: undefined, mac: k.key } : k));

/** Completions for the script API, offered at identifiers. */
function scriptCompletions(entries) {
  return (ctx) => {
    const word = ctx.matchBefore(/[\w$.]+/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const text = word.text;
    const dot = text.lastIndexOf('.');
    const prefix = dot >= 0 ? text.slice(0, dot + 1) : '';
    const options = entries
      .filter((e) => e.label.startsWith(prefix) && e.label.length > prefix.length)
      .map((e) => ({ label: e.label.slice(prefix.length), detail: e.detail, type: e.type || 'property', apply: e.apply ? e.apply.slice(prefix.length) : undefined }))
      .filter((o) => !o.label.includes('.'));
    return { from: word.from + (dot + 1), options, validFor: /^[\w$]*$/ };
  };
}

/**
 * createEditor({ parent, doc, language, readOnly, lineNumbers, wrap, fold, placeholder,
 *   onChange, onSubmit, isVariableDefined, completions, label, large })
 * large can change later with setLarge().
 */
export function createEditor(opts) {
  const langC = new Compartment();
  const wrapC = new Compartment();
  const readC = new Compartment();
  const varsC = new Compartment();
  const foldC = new Compartment();
  // Large documents go without highlighting and folding, which parse all of the text again after every edit.
  let large = !!opts.large;
  let language = opts.language;
  const folding = () => (opts.fold !== false && !large ? [codeFolding(), foldGutter({ markerDOM: foldMarker })] : []);
  // CodeMirror keeps lines joined by \n. A document written with \r\n throughout is
  // handed back that way, so an edit does not change the bytes of its other lines.
  let crlf = false;
  const readLineBreaks = (text) => {
    crlf = text.includes('\r\n') && !/\r(?!\n)|(?<!\r)\n/.test(text);
  };
  const withLineBreaks = (text) => (crlf ? text.replace(/\n/g, '\r\n') : text);
  readLineBreaks(opts.doc || '');
  const extensions = [
    highlightSpecialChars(),
    drawSelection(),
    history(),
    opts.lineNumbers !== false ? [lineNumbers(), highlightActiveLineGutter()] : [],
    foldC.of(folding()),
    syntaxHighlighting(style, { fallback: true }),
    bracketMatching(),
    indentOnInput(),
    closeBrackets(),
    highlightSelectionMatches(),
    search({ top: true }),
    opts.readOnly ? [] : highlightActiveLine(),
    langC.of(large ? [] : languageExtension(language)),
    wrapC.of(opts.wrap ? EditorView.lineWrapping : []),
    readC.of([EditorState.readOnly.of(!!opts.readOnly), EditorView.editable.of(!opts.readOnly)]),
    varsC.of(opts.isVariableDefined ? variableHighlighter(opts.isVariableDefined) : []),
    opts.placeholder ? cmPlaceholder(opts.placeholder) : [],
    opts.completions ? autocompletion({ override: [scriptCompletions(opts.completions)] }) : autocompletion({ override: [] }),
    keymap.of([
      ...(opts.onSubmit ? [{ key: 'Mod-Enter', run: () => (opts.onSubmit(), true) }] : []),
      { key: 'Mod-/', run: toggleComment },
      ...closeBracketsKeymap,
      // Mod-Enter is left to the app (send request, run collection).
      ...defaultKeymap.filter((k) => k.key !== 'Mod-Enter'),
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeys,
      ...completionKeymap,
      ...(opts.readOnly ? [] : [indentWithTab]),
    ]),
    theme,
    EditorView.contentAttributes.of({ 'aria-label': opts.label || 'Code editor', 'aria-multiline': 'true', ...(opts.readOnly ? { tabindex: '0', 'aria-readonly': 'true' } : {}) }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && opts.onChange) opts.onChange(withLineBreaks(u.state.doc.toString()));
    }),
  ];
  const view = new EditorView({ parent: opts.parent, state: EditorState.create({ doc: opts.doc || '', extensions }) });
  return {
    view,
    getValue: () => withLineBreaks(view.state.doc.toString()),
    setValue(text) {
      if (text === withLineBreaks(view.state.doc.toString())) return;
      readLineBreaks(text);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setLanguage(lang) {
      language = lang;
      view.dispatch({ effects: langC.reconfigure(large ? [] : languageExtension(lang)) });
    },
    setLarge(on) {
      if (on === large) return;
      large = on;
      view.dispatch({ effects: [langC.reconfigure(large ? [] : languageExtension(language)), foldC.reconfigure(folding())] });
    },
    setWrap(on) {
      view.dispatch({ effects: wrapC.reconfigure(on ? EditorView.lineWrapping : []) });
    },
    setReadOnly(on) {
      view.dispatch({ effects: readC.reconfigure([EditorState.readOnly.of(on), EditorView.editable.of(!on)]) });
    },
    refreshVariables() {
      if (opts.isVariableDefined) view.dispatch({ effects: varsC.reconfigure(variableHighlighter(opts.isVariableDefined)) });
    },
    openSearch() {
      openSearchPanel(view);
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

function foldMarker(open) {
  const span = document.createElement('span');
  span.textContent = open ? '▾' : '▸';
  span.style.color = 'var(--text-faint)';
  return span;
}

