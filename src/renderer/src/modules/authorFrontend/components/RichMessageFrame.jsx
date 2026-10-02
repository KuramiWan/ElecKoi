import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMainPageView } from '../../../app/windows/MainPageContext.jsx';
import { buildRichMessageHtml } from '../model/buildRichMessageHtml.js';
import { subscribeAuthorConversationEvents } from '../model/authorConversationEvents.js';
import { routeAuthorHostInputRequest } from '../model/authorHostInput.js';
import { routeAuthorAudioRequest, subscribeAuthorAudioEvents } from '../model/authorAudioHost.js';
import { routeAuthorConversationRequest } from '../model/authorConversationHost.js';
import { prepareAuthorRuntimeLibraries } from '../model/authorRuntimeLibraries.js';

const minimumHeight = 1;

function createChannel() {
  return globalThis.crypto?.randomUUID?.() || `rich-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function RichMessageFrame({ message, document, rootIndex = 0 }) {
  const { conversations, models } = useMainPageView();
  const frameRef = useRef(null);
  const viewportWidthRef = useRef(0);
  const [height, setHeight] = useState(minimumHeight);
  const channel = useMemo(createChannel, [message.id, document.contentKey, rootIndex]);
  const runtimeLibraries = useMemo(prepareAuthorRuntimeLibraries, []);
  const source = useMemo(
    () => buildRichMessageHtml(document, channel, runtimeLibraries),
    [channel, document.kind, document.source, runtimeLibraries],
  );

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    viewportWidthRef.current = 0;
    const applyViewportWidth = () => {
      const viewportWidthPx = Math.max(1, Math.round(frame.clientWidth || 1));
      if (viewportWidthRef.current === viewportWidthPx) return;
      viewportWidthRef.current = viewportWidthPx;
      // A document that uses 100vh must be measured from a collapsed viewport.
      // Reusing its previous iframe height turns that height into a permanent
      // minimum and leaves false blank space below otherwise shorter content.
      setHeight(minimumHeight);
    };
    applyViewportWidth();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(applyViewportWidth)
      : null;
    observer?.observe(frame);
    return () => {
      observer?.disconnect();
      viewportWidthRef.current = 0;
    };
  }, [channel]);

  useEffect(() => {
    const publish = ({ name, payload }) => {
      const response = JSON.stringify({ type: 'event', event: name, payload });
      frameRef.current?.contentWindow?.postMessage({
        type: 'eleckoi:author-response',
        channel,
        response,
      }, '*');
    };
    const disposeConversation = subscribeAuthorConversationEvents(conversations, message.conversationId, publish);
    const disposeAudio = subscribeAuthorAudioEvents(message.conversationId, publish);
    return () => { disposeConversation(); disposeAudio(); };
  }, [channel, conversations, message.conversationId]);

  useEffect(() => {
    const receive = async (event) => {
      const frameWindow = frameRef.current?.contentWindow;
      const data = event.data;
      if (event.source !== frameWindow || !data) return;
      if (data.channel !== channel) return;
      if (data.type === 'eleckoi:rich-height') {
        const measuredHeight = Math.ceil(Number(data.height));
        const next = Number.isFinite(measuredHeight)
          ? Math.max(minimumHeight, measuredHeight)
          : minimumHeight;
        setHeight((current) => current === next ? current : next);
        return;
      }
      if (data.type !== 'eleckoi:author-request' || typeof data.request !== 'string') return;
      let response;
      try {
        response = await routeAuthorAudioRequest(data.request, message.conversationId);
        if (response === null) response = await routeAuthorHostInputRequest(data.request, message.conversationId);
        if (response === null) response = await routeAuthorConversationRequest(data.request, {
          bridgeKey: channel,
          conversationId: message.conversationId,
          messageId: message.id,
          conversations,
          models,
        });
      } catch (error) {
        let id = '';
        try { id = String(JSON.parse(data.request)?.id || ''); } catch { /* invalid requests keep an empty id */ }
        response = JSON.stringify({
          id,
          ok: false,
          error: { code: error?.code || 'BRIDGE_ERROR', message: error?.message || '作者 API 调用失败' },
        });
      }
      try {
        const authorRequest = JSON.parse(data.request);
        const authorResponse = JSON.parse(response);
        if (authorResponse?.ok && [
          'variables.setState',
          'variables.merge',
          'variables.applyPatch',
          'variables.reset',
          'openings.select',
          'messages.deleteFrom',
          'messages.regenerate',
          'messages.editAndRegenerate',
          'chat.send',
          'chat.stopGeneration',
          'chat.create',
          'chat.open',
          'chat.delete',
          'chat.selectModel',
        ].includes(authorRequest?.method)) {
          window.dispatchEvent(new CustomEvent('eleckoi:author-action', { detail: {
            conversationId: message.conversationId,
            method: authorRequest.method,
            result: authorResponse.result,
          } }));
        }
      } catch { /* the SDK response still returns to the frame */ }
      frameWindow?.postMessage({ type: 'eleckoi:author-response', channel, response }, '*');
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel, conversations, message.conversationId, message.id, models]);

  return (
    <iframe
      ref={frameRef}
      className="rich-message-frame"
      title="互动消息内容"
      allow="fullscreen; autoplay; clipboard-read; clipboard-write"
      loading="eager"
      srcDoc={source}
      style={{ height: `${height}px` }}
    />
  );
}
