// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as libraries from '@eleckoi/dsh-client-html-resources/browser-libraries';
import { RichMessageFrame, RichMessageRenderProvider } from '../apps/web/src/modules/authorFrontend/index.js';
import { MessageBubble } from './helpers/officialMarkdown.jsx';
import { decorateRichDisplayReplacement } from '../packages/shared/src/foundation/richMessage';
import { useRichMessageRenderPermission } from '../apps/web/src/modules/authorFrontend/hooks/RichMessageRenderContext.jsx';

let root, container;
const assistant = id => ({ id, conversationId: 'chat-a', role: 'assistant', content: 'Narrative', status: 'complete' });
const a = assistant('reply-a'), b = assistant('reply-b'), c = assistant('reply-c');
const documentValue = { contentKey: 'synthetic-card', source: '<section>Card</section>' };
const render = (messages, enabled = true, floorLimit = 1, doc = documentValue, conversationId = 'chat-a') => act(() => root.render(
  <RichMessageRenderProvider key={conversationId} messages={messages} enabled={enabled} floorLimit={floorLimit}>
    {messages.filter(message => message.role === 'assistant' && !message.pending).map(message =>
      <div key={message.id} data-message={message.id}><RichMessageFrame message={message} document={doc} /></div>)}
  </RichMessageRenderProvider>));
const row = id => container.querySelector(`[data-message="${id}"]`);
const click = selector => act(() => container.querySelector(selector).click());

beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const ready = { status: 'ready', error: '' };
  window.__ElecKoiHtmlResources = { assetsBaseUrl: '/eleckoi/html/', sdk: libraries,
    getSnapshot: () => ready, subscribe: () => () => {} };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount()); container.remove();
  delete window.__ElecKoiHtmlResources; vi.unstubAllGlobals();
});

describe('rich message floor limit', () => {
  it('does not notify mounted documents on unrelated streaming chunks or while limits are disabled', async () => {
    const changed = vi.fn();
    const Reader = React.memo(function Reader() { changed(useRichMessageRenderPermission(a.id).active); return null; });
    const update = (enabled, content) => act(() => root.render(<RichMessageRenderProvider
      messages={[a, { ...b, pending: true, status: 'streaming', content }]} enabled={enabled} floorLimit={1}><Reader /></RichMessageRenderProvider>));
    await update(false, 'First chunk');
    changed.mockClear(); await update(false, 'Next chunk');
    expect(changed).not.toHaveBeenCalled();
    await update(true, 'Next chunk');
    changed.mockClear(); await update(true, 'Another chunk');
    expect(changed).not.toHaveBeenCalled();
  });

  it('clears manual permissions when disabled or when the selected message is deleted', async () => {
    await render([a, b, c]);
    await click('[data-message="reply-a"] .rich-message-load');
    await render([a, b, c], false);
    await render([a, b, c], true);
    expect(row(a.id).querySelector('iframe')).toBeNull();
    await click('[data-message="reply-a"] .rich-message-load');
    await render([b, c]); await render([a, b, c]);
    expect(row(a.id).querySelector('iframe')).toBeNull();
  });
  it('starts only the most recent completed AI floors, ignoring user and pending messages', async () => {
    const user = { id: 'user-a', role: 'user' }, pending = { ...c, pending: true, status: 'streaming' };
    await render([a, b, user, pending]);
    expect(row(a.id).querySelector('iframe')).toBeNull();
    expect(row(b.id).querySelector('iframe')).not.toBeNull();
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    await render([a, b, user, c]);
    expect(row(b.id).querySelector('iframe')).toBeNull();
    expect(row(c.id).querySelector('iframe')).not.toBeNull();
    await render([a, b, c], true, 2);
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
    expect(row(a.id).querySelector('iframe')).toBeNull();
  });

  it('keeps at most one manually opened old floor and releases it on stop or conversation change', async () => {
    await render([a, b, c]);
    const latest = row(c.id).querySelector('iframe');
    await click('[data-message="reply-a"] .rich-message-load');
    const old = row(a.id).querySelector('iframe');
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
    await click('[data-message="reply-b"] .rich-message-load');
    expect(old.isConnected).toBe(false);
    expect(row(c.id).querySelector('iframe')).toBe(latest);
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
    await click('.rich-message-stop');
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    await click('[data-message="reply-a"] .rich-message-load');
    await render([a, b, c], true, 1, documentValue, 'chat-b');
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(row(a.id).querySelector('iframe')).toBeNull();
  });

  it('retains measured space while stopped and drops it when authored content changes', async () => {
    await render([a]);
    const frame = row(a.id).querySelector('iframe');
    const channel = JSON.parse(frame.srcdoc.match(/const channel=("[^"\n]+");/)[1]);
    await act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
      data: { channel, type: 'eleckoi:rich-height', height: 248 } })));
    await render([a, b]);
    expect(frame.isConnected).toBe(false);
    expect(row(a.id).querySelector('.rich-message-placeholder').style.minHeight).toBe('248px');
    await click('[data-message="reply-a"] .rich-message-load');
    expect(row(a.id).querySelector('iframe').style.height).toBe('248px');
    await click('.rich-message-stop');
    await render([a, b], true, 1, { contentKey: 'changed', source: '<section>Changed</section>' });
    expect(row(a.id).querySelector('.rich-message-placeholder').style.minHeight).toBe('');
  });

  it('restores unrestricted rendering when disabled and preserves allowed documents when toggled', async () => {
    await render([a, b], false);
    const latest = row(b.id).querySelector('iframe');
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
    await render([a, b], true);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(row(b.id).querySelector('iframe')).toBe(latest);
    await render([a, b], false);
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
    expect(row(b.id).querySelector('iframe')).toBe(latest);
  });

  it('settles deferred parts so narrative and load controls remain visible without starting a document', async () => {
    await act(() => root.render(<RichMessageRenderProvider messages={[a, b]} enabled floorLimit={1}>
      <MessageBubble message={{ ...a, displayContent: 'Visible narrative\n' + decorateRichDisplayReplacement('<section>Card</section>') }} />
    </RichMessageRenderProvider>));
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('Visible narrative');
    expect(container.querySelector('.rich-message-staging').style.visibility).not.toBe('hidden');
    expect(container.querySelector('.rich-message-load')).not.toBeNull();
  });
});
