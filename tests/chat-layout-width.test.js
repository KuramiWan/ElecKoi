import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatStyles = readFileSync(
  new URL('../src/renderer/src/modules/chat/styles/chat-panel.css', import.meta.url),
  'utf8',
);

describe('chat layout width alignment', () => {
  it('keeps the Agent text column aligned with the official DSH composer inset', () => {
    expect(chatStyles).toMatch(
      /--dsh-composer-card-max-width:\s*calc\(var\(--dsh-chat-content-width\) \+ 32px\);/,
    );
    expect(chatStyles).toMatch(
      /--chat-reading-width:\s*var\(--dsh-chat-content-width\);/,
    );
    expect(chatStyles).toMatch(
      /--chat-composer-card-max-width:\s*var\(--dsh-composer-card-max-width\);/,
    );
    expect(chatStyles).toMatch(
      /\.message-agent\s*\{[^}]*width:\s*min\(var\(--chat-composer-card-max-width\), 100%\);[^}]*padding-right:\s*var\(--chat-horizontal-padding, 16px\);[^}]*padding-left:\s*var\(--chat-horizontal-padding, 16px\);/,
    );
  });

  it('keeps Agent messages at the same width while selecting messages for deletion', () => {
    expect(chatStyles).toMatch(
      /\.message-delete-selection-row\.layout-agent\s*\{[^}]*width:\s*min\(calc\(var\(--chat-composer-card-max-width\) \+ 30px\), 100%\);/,
    );
  });
});
