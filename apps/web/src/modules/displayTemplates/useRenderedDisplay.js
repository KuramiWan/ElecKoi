import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';
import { useEffect, useMemo, useState } from 'react';
import { runDisplayTemplates } from './runtime/runDisplayTemplates.js';
const emptyLibraries = [];

export function useRenderedDisplay(message, content, libraries = emptyLibraries) {
  const input = useMemo(() => {
    if (message.role !== 'assistant' || message.pending || message.status === 'streaming'
      || !libraries.some(library => library.enabled && library.templates.some(template => template.enabled))) return null;
    let variables = null, error = '';
    try {
      if (message.variableSnapshotAvailable === false) variables = null;
      else if (message.variableState !== undefined) variables = message.variableState;
      else {
        const json = message.nativeVariableStateJson ?? message.variableStateJson;
        if (json !== undefined) variables = JSON.parse(json);
      }
      if (variables !== null && (!variables || typeof variables !== 'object' || Array.isArray(variables))) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '消息变量快照必须是 JSON 对象。', { what: '消息变量快照' });
    } catch (cause) { error = cause.message; }
    return { libraries, content, variables, error, message: { id: message.id, conversationId: message.conversationId,
      role: message.role, status: message.status ?? 'complete', content: message.content ?? '' } };
  }, [libraries, content, message.id, message.conversationId, message.role, message.status, message.pending,
    message.content, message.variableState, message.nativeVariableStateJson, message.variableStateJson, message.variableSnapshotAvailable]);
  const [accepted, setAccepted] = useState(null);
  useEffect(() => {
    if (!input) return undefined;
    const controller = new AbortController();
    if (input.error) setAccepted({ input, content, error: input.error });
    else void runDisplayTemplates(input, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setAccepted({ input, content: result.content,
        error: result.errors.map(error => `${error.templateName}：${error.message}`).join('\n') });
    }).catch(error => {
      if (!controller.signal.aborted) setAccepted({ input, content, error: error.message });
    });
    return () => controller.abort();
  }, [input]);
  const sameSource = accepted && input && accepted.input.message.id === input.message.id
    && accepted.input.message.conversationId === input.message.conversationId
    && accepted.input.message.content === input.message.content && accepted.input.content === input.content;
  return input && sameSource ? { content: accepted.content, error: accepted.error } : { content, error: '' };
}
