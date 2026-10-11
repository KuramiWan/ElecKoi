import { buildSharedFrontendDocument } from './sharedFrontendDocument.js';

/** Imported rich HTML uses the application's presentation resources. */
export function buildRichMessageHtml(document, channel, runtime, options = {}) {
  return buildSharedFrontendDocument(document.source, runtime, { ...options, channel, frameId: channel, rich: true });
}
