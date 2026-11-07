// Diagnostics belong to the opened preview, never to serialized document data.
export function recordPreviewIssue(issues, error) {
  const detail = typeof error?.feature === 'string' ? error.feature : error?.message;
  if (typeof detail === 'string' && detail.trim()) issues.add(detail.trim());
}
