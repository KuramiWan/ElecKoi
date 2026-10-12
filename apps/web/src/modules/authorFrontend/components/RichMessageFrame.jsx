import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHtmlResources } from '../../../ui/hooks/useHtmlResources.js';
import { buildRichMessageHtml } from '../model/buildRichMessageHtml.js';
import { readAuthorDocumentDeclaration } from '@eleckoi/author-sdk';
import { NativeMessageFrame } from './NativeMessageFrame.jsx';

const minimumHeight = 1;

function createChannel() {
  return globalThis.crypto?.randomUUID?.() || `rich-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function RichMessageFrame(props) {
  const declaration = useMemo(() => readAuthorDocumentDeclaration(props.document.source), [props.document.source]);
  const settled = useRef(props.onSettled);
  settled.current = props.onSettled;
  useLayoutEffect(() => {
    if (declaration.kind === 'unsupported') settled.current?.({ status: 'error', error: declaration.error });
  }, [declaration]);
  if (declaration.kind === 'unsupported') return <div className="rich-message-error" role="alert">互动消息加载失败：{declaration.error}</div>;
  if (declaration.kind === 'native') return <NativeMessageFrame {...props} />;
  return <SharedMessageFrame {...props} />;
}

function SharedMessageFrame({ message, document, rootIndex = 0, onSettled }) {
  const { runtime, state } = useHtmlResources();
  const frameRef = useRef(null);
  const [height, setHeight] = useState(minimumHeight);
  const [error, setError] = useState('');
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const channel = useMemo(createChannel, [message.conversationId, message.id, document.contentKey, rootIndex]);
  const committedDocument = useMemo(() => ({ source: null }), [channel, document.source, message.id, runtime]);
  const source = useMemo(() => runtime && state.status === 'ready'
    ? buildRichMessageHtml(document, channel, runtime, { messageId: message.id, conversationId: message.conversationId })
    // Projection refreshes must not destroy an unchanged author's document.
    : state.status === 'waiting-for-chat' ? committedDocument.source : null,
    [channel, committedDocument, document.source, message.id, message.conversationId, runtime, state.status]);
  useLayoutEffect(() => {
    if (source && state.status === 'ready') committedDocument.source = source;
  }, [committedDocument, source, state.status]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    // Register and reset before the iframe can report its first height.
    setError(''); setHeight(minimumHeight);
    let ready = false, measured = false, reported = false;
    const reportReady = () => {
      if (!ready || !measured || reported) return;
      reported = true;
      settled.current?.({ status: 'ready' });
    };
    const receive = event => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.channel !== channel) return;
      if (event.data.type === 'eleckoi:rich-height') {
        const value = Number(event.data.height);
        if (Number.isFinite(value)) {
          setHeight(Math.max(minimumHeight, Math.ceil(value)));
          measured = true; reportReady();
        }
      } else if (event.data.type === 'eleckoi:frontend-ready') {
        ready = true; reportReady();
      } else if (event.data.type === 'eleckoi:frontend-error') {
        const failure = String(event.data.message);
        setError(failure);
        if (!reported) { reported = true; settled.current?.({ status: 'error', error: failure }); }
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
    };
  }, [channel, runtime, source]);
  useLayoutEffect(() => {
    if (state.status === 'error') settled.current?.({ status: 'error', error: state.error });
  }, [state.status, state.error]);
  if (error || state.status === 'error') return <div className="rich-message-error" role="alert">互动消息加载失败：{error || state.error}</div>;
  if (!source) return <div className="rich-message-loading" role="status">正在加载互动消息…</div>;
  return <iframe ref={frameRef} className="rich-message-frame" title="互动消息内容"
    allow="fullscreen; autoplay; clipboard-read; clipboard-write" loading="eager" srcDoc={source}
    style={{ height: `${height}px` }} />;
}
