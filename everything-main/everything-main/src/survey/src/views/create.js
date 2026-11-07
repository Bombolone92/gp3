/**
 * Ways to start a survey other than a blank one: the template gallery, AI
 * generation from a description, and importing (a survey file or pasted
 * questions). Each resolves to a survey document (not yet saved) or null.
 */
export async function chooseTemplate(app) {
  const { openTemplates } = await import('./templates-dialog.js');
  return openTemplates(app);
}

export async function generateWithAI(app, prompt) {
  const { openAiDialog } = await import('./ai-dialog.js');
  return openAiDialog(app, prompt);
}

export async function importSurvey(app) {
  const { openImportDialog } = await import('./import-dialog.js');
  return openImportDialog(app);
}
