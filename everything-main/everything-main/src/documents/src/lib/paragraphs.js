/** The story containing the selected text (body when the engine omits it). */
export function selectionStory(snap) {
  return snap?.selectionTarget?.story || snap?.selectionTarget?.start?.story || snap?.target?.story;
}

/** A paragraph address scoped to its header, footer, or note when necessary. */
export function paragraphTarget(nodeId, story) {
  return { kind: 'block', nodeType: 'paragraph', nodeId, ...(story ? { story } : {}) };
}

/** getNodeById reads the body; other stories require a scoped address. */
export function readParagraph(api, nodeId, story) {
  return story && story.storyType !== 'body'
    ? api.getNode(paragraphTarget(nodeId, story))
    : api.getNodeById({ nodeId });
}
