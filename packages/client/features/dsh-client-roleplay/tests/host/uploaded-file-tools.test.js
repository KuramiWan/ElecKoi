import { describe, expect, it } from 'vitest';
import { apply } from '../../../../../../apps/desktop/resources/dsh/uploaded-file-tools.mjs';

describe('uploaded file tool', () => {
  it('reads beyond fifty kilobytes by default and accepts an explicit larger page', async () => {
    const text = 'Synthetic upload '.repeat(10001) + 'tail-marker';
    const bytes = Buffer.from(text);
    const file = { attachmentId: `sha256:${'b'.repeat(64)}`, name: 'synthetic.txt', bytes: bytes.length };
    let tool;
    apply({ tools: { register(value) { tool = value; return () => {}; } },
      sessionQuery: { readSurface: async () => ({ events: [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'file', attachment: file }] } }] }) },
      attachments: { fileHostPath: () => '/files/synthetic.txt', async *readFileStream() { for (let offset = 0; offset < bytes.length; offset += 4096) yield bytes.subarray(offset, offset + 4096); } },
      fs: { processPathFromHostPath: path => path },
    });
    const exec = { agent: { session: { id: 'synthetic-upload' } }, signal: new AbortController().signal };
    expect(await tool.execute({ file_path: file.attachmentId }, exec)).toMatchObject({ content: text, next_offset: null });
    expect(await tool.execute({ file_path: file.attachmentId, limit: 100001 }, exec)).toMatchObject({ content: text.slice(0, 100001), next_offset: 100001 });
  });

  it('reads only a file referenced by the current user surface', async () => {
    const file = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'notes.md', bytes: 11 };
    let tool;
    const ctx = {
      tools: { register(value) { tool = value; return () => {}; } },
      sessionQuery: { async readSurface() { return { events: [{ type: 'user/message', data: {
        message: { source: { kind: 'user' }, content: [{ type: 'file', attachment: file }] },
      } }] }; } },
      attachments: {
        fileHostPath() { return '/files/notes.md'; },
        async *readFileStream() { yield Buffer.from('hello world'); },
      },
      fs: { processPathFromHostPath(path) { return path; } },
    };
    apply(ctx);
    const exec = { agent: { session: { id: 'session' } }, signal: new AbortController().signal };
    expect(await tool.execute({ file_path: '/files/notes.md' }, exec)).toMatchObject({ status: 'ok', content: 'hello world' });
    expect(await tool.execute({ file_path: '/files/other.md' }, exec)).toMatchObject({ status: 'error' });
  });
});
