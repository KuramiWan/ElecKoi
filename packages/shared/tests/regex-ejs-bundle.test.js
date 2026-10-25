import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');

it('preserves standard EJS escaping and author errors after browser minification', async () => {
  const result = await build({ entryPoints: [resolve('packages/shared/src/foundation/regex/RegexEjs.js')],
    bundle: true, minify: true, platform: 'browser', format: 'cjs', write: false });
  const context = { module: { exports: {} }, exports: {} };
  runInNewContext(result.outputFiles[0].text, context);
  const evaluate = content => context.module.exports.evaluateRegexEjs({ content: '<!-- eleckoi:regex-ejs:start -->'+content+'<!-- eleckoi:regex-ejs:end -->',
    rawContent: 'Synthetic text', variables: { score: 12 }, surface: 'Display', message: { id: 'synthetic-message', conversationId: 'synthetic-chat', role: 'assistant', status: 'complete', content: 'Synthetic text' } });
  expect(await evaluate('<%= await Promise.resolve(getvar("score")) %>')).toBe('12');
  expect(await evaluate('<%= "&<>\\\"\\\'" %>')).toBe('&amp;&lt;&gt;&#34;&#39;');
  await expect(evaluate('<% throw new Error("Synthetic bundled error") %>')).rejects.toThrow('Synthetic bundled error');
});
