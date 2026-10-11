import { describe, expect, it } from 'vitest';
import * as libraries from '@eleckoi/compatibility-tavern-shared/browser-libraries';
import { buildRichMessageHtml } from '../apps/web/src/modules/authorFrontend/model/buildRichMessageHtml.js';

const runtime = { assetsBaseUrl: '/eleckoi/compat/', sdk: libraries };

describe('shared rich message document', () => {
  it('loads browser resources without installing external SDK interfaces', () => {
    const output = buildRichMessageHtml({ source: '<html><head><script>window.cardLoaded=true</script></head><body>card</body></html>' },
      'channel-a', runtime, { messageId: 'message-a', conversationId: 'chat-a' });
    expect(output).not.toContain('Content-Security-Policy');
    for (const name of ['prepareDocument', 'TavernHelper', 'SillyTavern', 'mvu-engine.js', 'mvu-schema.js']) expect(output).not.toContain(name);
    expect(output).toContain('ElecKoiFrontendContext=null');
    expect(output).toContain('eleckoi:frontend-ready');
    for (const file of [...libraries.BROWSER_LIBRARY_SCRIPTS, ...libraries.BROWSER_LIBRARY_STYLES]) {
      expect(output).toContain(`/eleckoi/compat/assets/assets/${file}`);
      expect(output.indexOf(file)).toBeLessThan(output.indexOf('window.cardLoaded'));
    }
    expect(output.indexOf('type="importmap"')).toBeLessThan(output.indexOf('window.cardLoaded'));
  });
  it('wraps fragments in a transparent document and retains body-only documents', () => {
    const fragment = buildRichMessageHtml({ source: '<div class="card">card</div>' }, 'channel-b', runtime);
    expect(fragment.startsWith('<!doctype html><html><head>')).toBe(true);
    expect(fragment).toContain('<body><div class="card">card</div></body>');
    expect(fragment).toContain('background:transparent');
    const body = buildRichMessageHtml({ source: '<body><main>panel</main></body>' }, 'channel-c', runtime);
    expect(body).toContain('</head><body><main>panel</main>');
    expect(body).not.toContain('<body><body>');
  });
  it('diagnoses a missing shared runtime instead of emitting an unusable document', () => {
    expect(() => buildRichMessageHtml({ source: '<div>card</div>' }, 'channel')).toThrow();
  });
});
