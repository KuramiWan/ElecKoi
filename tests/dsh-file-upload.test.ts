import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DshDesktopPluginHost, DshRuntime, readDshTranscript } from '@eleckoi/dsh-runtime'
import { describe, expect, it } from 'vitest'

describe('DSH file upload', () => {
  it('removes read-only attachments while keeping a retained file object immutable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eleckoi-dsh-attachment-'))
    const runtimeRoot = join(root, 'runtime')
    const runtime = new DshRuntime({
      configPath: '', presetTemplatePath: '', workspaceRoot: join(root, 'workspace'),
      runtimeDataRoot: runtimeRoot, executablePath: process.execPath
    })
    const digest = 'a'.repeat(64)
    const base = join(runtimeRoot, 'home', 'attachments', 'v1')
    const objectPath = join(base, 'file-objects', digest.slice(0, 2), digest)
    const filePath = join(base, 'files', digest.slice(0, 2), digest, 'notes.md')
    const imagePath = join(base, 'objects', digest.slice(0, 2), digest)
    try {
      await mkdir(join(base, 'file-objects', digest.slice(0, 2)), { recursive: true })
      await mkdir(join(base, 'files', digest.slice(0, 2), digest), { recursive: true })
      await mkdir(join(base, 'objects', digest.slice(0, 2)), { recursive: true })
      await writeFile(objectPath, 'file')
      await link(objectPath, filePath)
      await chmod(objectPath, 0o400)
      await writeFile(imagePath, 'image')
      await chmod(imagePath, 0o400)

      runtime.removeFile({ attachmentId: `sha256:${digest}`, name: 'notes.md', bytes: 4 }, true)
      await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await stat(objectPath)).mode & 0o222).toBe(0)
      runtime.removeImage(`sha256:${digest}`)
      await expect(stat(imagePath)).rejects.toMatchObject({ code: 'ENOENT' })
      runtime.removeFile({ attachmentId: `sha256:${digest}`, name: 'notes.md', bytes: 4 }, false)
      await expect(stat(objectPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await chmod(objectPath, 0o600).catch(() => {})
      await runtime.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stores the file through the plugin and records its reference in the Session log', async () => {
    const requests: string[] = []
    const body = 'PRIVATE_TEST_FILE_BODY_SENTINEL'
    const attachmentId = `sha256:${createHash('sha256').update(body).digest('hex')}`
    const server = createServer(async (request, response) => {
      let requestBody = ''
      for await (const chunk of request) requestBody += chunk.toString()
      requests.push(requestBody)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const base = { id: 'chatcmpl-file', object: 'chat.completion.chunk', created: 1, model: 'deepseek-chat' }
      const choices = requests.length === 1 ? [
        { delta: { role: 'assistant', content: '' }, finish_reason: null },
        { delta: { tool_calls: [{ index: 0, id: 'call-file-1', type: 'function', function: {
          name: 'eleckoi_read_uploaded_file', arguments: JSON.stringify({ file_path: attachmentId })
        } }] }, finish_reason: null },
        { delta: {}, finish_reason: 'tool_calls' }
      ] : [
        { delta: { role: 'assistant', content: '' }, finish_reason: null },
        { delta: { content: '收到' }, finish_reason: null },
        { delta: {}, finish_reason: 'stop' }
      ]
      for (const choice of choices) response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, ...choice }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Local server has no port')
    const root = await mkdtemp(join(tmpdir(), 'eleckoi-dsh-file-'))
    const filePath = join(root, 'notes.md')
    await writeFile(filePath, body)
    const runtime = new DshRuntime({
      configPath: resolve('resources/dsh/cordis.yml'),
      presetTemplatePath: resolve('resources/dsh/agent-preset-template/agent.cordis.yml'),
      workspaceRoot: join(root, 'workspace'), runtimeDataRoot: join(root, 'runtime'), executablePath: process.execPath
    })
    runtime.bindSessionHost(new DshDesktopPluginHost({
      runtimeDataRoot: join(root, 'runtime'), workspaceRoot: join(root, 'workspace'),
      agentPatchPath: resolve('resources/dsh/desktop-agent.patch.yml'),
      hostConfiguration: () => runtime.hostConfiguration(), executablePath: process.execPath
    }))
    const uploaded: Array<{ draftId: string; attachmentId: string }> = []
    try {
      await expect(runtime.stream('file-chat', '请读文件', {
        configId: 'local-file-test', provider: 'deepseek', apiKey: 'local-test-key',
        baseUrl: `http://127.0.0.1:${address.port}`, model: 'deepseek-chat', systemPrompt: '',
        apiFormat: 'openai-completions', customHeaders: {}, contextWindow: 128000, supportsImageInput: false
      }, { onDelta: () => {}, onFinal: () => {}, onFileUploaded: (draftId, file) => {
        uploaded.push({ draftId, attachmentId: file.attachmentId })
      } }, undefined, undefined, 'file-session',
      { disabledGroupIds: ['builtin:workspace', 'builtin:other'] }, [], [], undefined, undefined, undefined, undefined,
      [{ id: 'draft', path: filePath, name: 'notes.md', bytes: Buffer.byteLength(body) }])).resolves.toBe('complete')
      const [file] = readDshTranscript(join(root, 'runtime', 'sessions'), 'file-session')?.[0]?.userFiles ?? []
      expect(file).toMatchObject({ name: 'notes.md', bytes: Buffer.byteLength(body) })
      expect(uploaded).toEqual([{ draftId: 'draft', attachmentId }])
      expect(await readFile(runtime.filePath(file!), 'utf8')).toBe(body)
      expect(requests[0]).toContain('notes.md')
      expect(requests[0]).not.toContain(body)
      expect(requests[0]).toContain('eleckoi_read_uploaded_file')
      expect(requests[1]).toContain(body)
      runtime.removeFile(file!, false)
      await expect(stat(runtime.filePath(file!))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(join(root, 'runtime', 'home', 'attachments', 'v1', 'file-objects', attachmentId.slice(7, 9), attachmentId.slice(7))))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await runtime.close()
      server.close()
      await once(server, 'close')
      await rm(root, { recursive: true, force: true })
    }
  }, 45_000)
})
