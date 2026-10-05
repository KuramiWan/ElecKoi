import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const chatStyles = readFileSync(
  new URL('../src/renderer/src/modules/chat/styles/chat-panel.css', import.meta.url),
  'utf8',
);
const officialComposer = readFileSync(
  require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'),
  'utf8',
);

const regionStyles = chatStyles.match(/\.chat-composer-region\s*\{([^}]+)\}/)?.[1];
const scrollStyles = chatStyles.match(/\.chat-composer-region \[data-input-scroll\]\s*\{([^}]+)\}/)?.[1];

describe('projected DSH composer scrolling', () => {
  it('restores the height cap supplied by the official composer seat', () => {
    const officialCap = officialComposer.match(/--dsh-composer-text-max-height:([^;]+);/)?.[1];
    expect(officialCap).toBe('336px');
    expect(regionStyles).toContain(`--dsh-composer-text-max-height: ${officialCap};`);
  });

  it('uses the official input scrollport without replacing its editor or growth behavior', () => {
    // These are the upstream contract points used by the scoped override. An
    // upstream change must be reviewed rather than silently losing the cap.
    expect(officialComposer).toContain('"data-input-scroll": true');
    expect(officialComposer).toContain('max-height:var(--dsh-composer-text-max-height)');
    expect(officialComposer).toMatch(/max-height:var\(--dsh-composer-text-max-height\);[^}]*overflow-y:auto/);
    expect(scrollStyles).not.toMatch(/(?:^|;)\s*(?:height|max-height|overflow(?:-[xy])?)\s*:/);
    expect(chatStyles).not.toMatch(/\.chat-composer-region[^{}]*\[data-composer-input\]/);
  });

  it('reserves a stable, draggable vertical scrollbar inside the composer only', () => {
    expect(scrollStyles).toContain('--dsh-scrollbar-width: 8px;');
    expect(scrollStyles).toContain('scrollbar-gutter: stable;');
    expect(chatStyles).toMatch(
      /\.chat-composer-region \[data-input-scroll\]::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--dsh-scrollbar-width\);/,
    );
  });

  it('keeps the scrollbar thumb visible without hover in both themes', () => {
    expect(chatStyles).toMatch(
      /\.chat-composer-region \[data-input-scroll\]::-webkit-scrollbar-thumb\s*\{[^}]*min-height:\s*28px;[^}]*background:\s*var\(--dsh-scrollbar-thumb, #[\da-f]+\);/,
    );
    expect(chatStyles).toMatch(
      /\.chat-composer-region \[data-input-scroll\]::-webkit-scrollbar-thumb:hover\s*\{[^}]*background:\s*var\(--dsh-scrollbar-thumb-hover, #[\da-f]+\);/,
    );
  });
});
