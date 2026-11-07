// Variables and data sets (Image > Variables, Apply Data Set; File > Import
// > Variable Data Sets; File > Export > Data Sets as Files).

import type { Editor } from '../../editor';
import { registerCommand } from '../../app/registry';
import { lazy, lazyRun } from '../../app/lazy';
import './variables.css';

// The dialogs and the exporter load on first use.
const dialogs = lazy(() => import('./dialogs'));
const exporter = lazy(() => import('./export'));

export function installVariables(e: Editor) {
  const hasSets = (e: Editor) => !!e.doc.variables?.sets.length;
  registerCommand(
    {
      id: 'image.variables-define',
      label: 'Define…',
      description: 'Bind layers to variables: visibility, text replacement and pixel replacement.',
      enabled: (e) => e.hasDocument && e.doc.layers.length > 0,
      ...lazyRun(dialogs, (m, e) => m.defineVariables(e)),
      recordable: false,
    },
    {
      id: 'image.variables-data-sets',
      label: 'Data Sets…',
      description: 'Create, edit, import and preview data sets that give each variable a value.',
      // Without variables the dialog explains how to define them.
      enabled: (e) => e.hasDocument,
      ...lazyRun(dialogs, (m, e) => m.dataSetsDialog(e)),
      recordable: false,
    },
    { id: 'image.apply-data-set', label: 'Apply Data Set…', enabled: hasSets, ...lazyRun(dialogs, (m, e) => m.applyDataSetDialog(e)), recordable: false },
    {
      id: 'file.import-data-sets',
      label: 'Variable Data Sets…',
      description: 'Read data sets from a CSV or tab-separated file whose first row names the variables.',
      enabled: (e) => e.hasDocument,
      ...lazyRun(dialogs, (m, e) => m.importDataSets(e)),
      recordable: false,
    },
    { id: 'file.export-data-sets', label: 'Data Sets as Files…', enabled: hasSets, ...lazyRun(exporter, (m, e) => m.exportDataSets(e)), recordable: false },
  );
  void e;
}
