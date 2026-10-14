import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { BlockAssembler, ReasoningEffortId, createAssistantMessage, createSystemMessage, createUserMessage,
  type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { encodingForModel, getEncoding, type Tiktoken, type TiktokenEncoding, type TiktokenModel } from 'js-tiktoken'
import { randomUUID } from 'node:crypto'
import type { TavernAuxiliaryGenerationEvent, TavernAuxiliaryGenerationResult } from './types.js'

type Value = Record<string, unknown>
const object = (value: unknown): Value => value && typeof value === 'object' && !Array.isArray(value) ? value as Value : {}
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const copy = <T>(value: T): T => structuredClone(value)

const methods = new Set([
  'configuration.list', 'configuration.get', 'configuration.describe', 'configuration.set', 'configuration.replace',
  'connections.list', 'connections.get', 'connections.current', 'connections.select', 'connections.models', 'connections.modelInfo', 'connections.configure',
  'tokens.count', 'tokens.encode', 'tokens.decode', 'tokens.encodings',
  'generation.auxiliary', 'generation.raw', 'auxiliary.generate', 'generation.cancel', 'generation.stop', 'generation.stopAll',
  'extensions.list', 'extensions.isInstalled', 'extensions.install', 'extensions.uninstall', 'extensions.enable', 'extensions.disable', 'extensions.update'
])

/** Dispatch existing profile/LLM services; token codecs contain actual BPE tables. */
export class NativeTavernOperations {
  private readonly tokenizers = new Map<string, Tiktoken>()
  private readonly generations = new Map<string, AbortController>()

  constructor(private readonly owner: Context) {
    owner.effect(() => () => {
      for (const controller of this.generations.values()) controller.abort(new Error('ElecKoi Host 已卸载。'))
      this.generations.clear(); this.tokenizers.clear()
    })
  }

  has(method: string): boolean { return methods.has(method) }
  concurrent(method: string): boolean { return /^(?:generation\.|auxiliary\.)/.test(method) || method === 'extensions.install' }

  private descriptor(namespace: string) {
    const descriptor = this.owner.settings.describe({ redactSecrets: true }).find(item => item.ns === namespace)
    if (!descriptor) throw new Error(`原生配置命名空间不存在：${namespace}`)
    return descriptor
  }

  private path(params: Value): string[] {
    if (params.path === undefined) return []
    if (!Array.isArray(params.path) || params.path.some(part => typeof part !== 'string' || !part)) throw new TypeError('原生配置路径必须是非空字符串数组。')
    return params.path as string[]
  }

  private readPath(value: unknown, path: readonly string[]): unknown {
    let current = value
    for (const part of path) {
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined
      current = (current as Value)[part]
    }
    return copy(current)
  }

  private selection(): Value {
    const selected = this.owner.agentDefaultModel.currentSelection()
    return { provider: selected.provider, model: selected.model,
      ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: String(selected.reasoningEffort) }) }
  }

  private connections(): Value[] {
    const settings = this.owner.settings.describe({ redactSecrets: true })
    const entries = object(object(settings.find(item => item.ns === 'eleckoi-client-models')?.value).entries)
    const selected = this.selection()
    const providers = new Map(this.owner.llm.listProviders().map(provider => [provider.id, provider]))
    const directory = this.owner.llm.listConfigurableProviders()
    const result: Value[] = directory.map(item => {
      const stored = object(entries[item.provider])
      const descriptor = settings.find(row => row.ns === item.settingsNs)
      return { ...stored, id: item.provider, provider: item.provider, name: text(stored.name, item.displayName),
        registered: providers.has(item.provider), settingsNamespace: item.settingsNs,
        settingsPath: item.settingsPath, configuration: descriptor ? this.readPath(descriptor.value, item.settingsPath ?? []) : {},
        ...(selected.provider === item.provider ? { model: selected.model } : {}) }
    })
    for (const [id, provider] of providers) if (!result.some(item => item.id === id)) {
      result.push({ ...object(entries[id]), id, provider: id, name: provider.name, registered: true,
        ...(selected.provider === id ? { model: selected.model } : {}) })
    }
    return result
  }

  async snapshot(): Promise<Value> {
    const manager = this.owner.get('pluginManager')
    const extensions = manager ? await manager.listBundles() : Array.from(this.owner.root.registry.values()).filter(runtime => runtime.name)
      .map(runtime => ({ name: runtime.name, enabled: Array.from(runtime.fibers).some(fiber => fiber.state === 2), kind: 'native-plugin' }))
    return { connections: this.connections(), selectedConnection: this.selection(), extensions,
      versions: { tavernHelper: '0.1.0', tavernCompatibility: '0.1.0', sillyTavern: '1.19.0' } }
  }

  async invoke(method: string, params: Value): Promise<unknown> {
    if (method === 'configuration.list') return this.owner.settings.describe({ redactSecrets: true }).map(item => ({ namespace: item.ns, value: copy(item.value), revision: item.revision, writable: this.owner.settings.writable }))
    if (method.startsWith('configuration.')) {
      const namespace = text(params.namespace, text(params.ns)), descriptor = this.descriptor(namespace), path = this.path(params)
      if (method === 'configuration.describe') return { namespace, value: copy(descriptor.value), revision: descriptor.revision, writable: this.owner.settings.writable, secrets: descriptor.secrets ?? [] }
      if (method === 'configuration.get') return this.readPath(descriptor.value, path)
      const revision = typeof params.expectedRevision === 'number' ? params.expectedRevision : descriptor.revision
      if (method === 'configuration.replace') {
        if (path.length) throw new Error('整段原生配置替换不接受字段路径。')
        await this.owner.settings.replace(namespace, object(params.value), revision)
      } else if (method === 'configuration.set') {
        if (path.length) await this.owner.settings.mutate(namespace, [{ op: 'set', path, value: params.value }], revision)
        else await this.owner.settings.update(namespace, object(params.value), revision)
      } else throw new Error(`未知原生配置操作：${method}`)
      return this.readPath(this.descriptor(namespace).value, path)
    }
    if (method === 'connections.list') return this.connections()
    if (method === 'connections.current') return this.selection()
    if (method === 'connections.get') {
      const id = text(params.id, text(params.name, text(params.provider)))
      const result = this.connections().find(item => item.id === id || item.name === id)
      if (!result) throw new Error(`原生连接配置不存在：${id}`)
      return result
    }
    if (method === 'connections.models') return this.owner.llm.listModels(text(params.provider, text(params.id)))
    if (method === 'connections.modelInfo') return this.owner.llm.resolveModelInfo(text(params.provider), text(params.model))
    if (method === 'connections.select') {
      const selected = object(params.selection ?? params)
      const resolved = await this.owner.llm.resolveCallConfig({ provider: text(selected.provider, text(selected.id)), model: text(selected.model),
        ...(typeof selected.reasoningEffort === 'string' ? { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) } : {}) })
      await this.owner.agentDefaultModel.saveSelection(resolved)
      return this.selection()
    }
    if (method === 'connections.configure') {
      if (params.namespace !== undefined || params.ns !== undefined) return this.invoke('configuration.set', params)
      const provider = text(params.provider, text(params.id))
      const entry = this.owner.llm.listConfigurableProviders().find(item => item.provider === provider)
      if (!entry) throw new Error(`原生连接没有可写配置目录：${provider}`)
      return this.invoke('configuration.set', { ...params, namespace: entry.settingsNs, path: [...entry.settingsPath] })
    }
    if (method === 'tokens.encodings') return ['gpt2', 'r50k_base', 'p50k_base', 'p50k_edit', 'cl100k_base', 'o200k_base']
    if (method.startsWith('tokens.')) {
      const codec = this.tokenizer(params)
      if (method === 'tokens.decode') {
        if (!Array.isArray(params.tokens ?? params.ids)) throw new TypeError('token 解码输入必须是整数数组。')
        const ids = array(params.tokens ?? params.ids)
        if (ids.some(value => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) throw new TypeError('token 必须是非负整数数组。')
        return codec.decode(ids as number[])
      }
      if (typeof params.text !== 'string') throw new TypeError('token 编码输入必须是文本。')
      const encoded = codec.encode(params.text, array(params.allowedSpecial).map(String), array(params.disallowedSpecial).map(String))
      return method === 'tokens.count' ? encoded.length : encoded
    }
    if (method === 'generation.cancel' || method === 'generation.stop') return this.cancel(text(params.generationId, text(params.id)))
    if (method === 'generation.stopAll') { const ids = [...this.generations.keys()]; for (const id of ids) this.cancel(id); return { cancelledIds: ids } }
    if (method === 'generation.auxiliary' || method === 'generation.raw' || method === 'auxiliary.generate') {
      let result: TavernAuxiliaryGenerationResult | undefined
      for await (const event of this.generate(params)) if (event.kind === 'finished') result = event
      if (!result) throw new Error('辅助生成没有正式结束结果。')
      return result
    }
    if (method.startsWith('extensions.')) return this.extension(method, params)
    throw new Error(`原生兼容操作尚未注册：${method}`)
  }

  private tokenizer(params: Value): Tiktoken {
    const encoding = text(params.encoding), model = text(params.model)
    if (!encoding && !model) throw new Error('token 编解码需要明确 model 或 encoding，不能把估算值当作实际 token。')
    const key = encoding ? `encoding:${encoding}` : `model:${model}`
    let tokenizer = this.tokenizers.get(key)
    if (!tokenizer) {
      tokenizer = encoding ? getEncoding(encoding as TiktokenEncoding) : encodingForModel(model as TiktokenModel)
      this.tokenizers.set(key, tokenizer)
    }
    return tokenizer
  }

  cancel(generationId: string): { generationId: string; cancelled: boolean } {
    const controller = this.generations.get(generationId)
    if (!controller) return { generationId, cancelled: false }
    controller.abort(new Error('辅助生成已取消。'))
    return { generationId, cancelled: true }
  }

  /** True streaming LLM call; no Session or conversation transcript is written. */
  async *generate(params: Value, externalSignal?: AbortSignal): AsyncIterable<TavernAuxiliaryGenerationEvent> {
    const generationId = text(params.generationId, text(params.generation_id, randomUUID()))
    if (this.generations.has(generationId)) throw new Error(`辅助生成编号正在使用：${generationId}`)
    const controller = new AbortController()
    const abort = () => controller.abort(externalSignal?.reason)
    if (externalSignal?.aborted) externalSignal.throwIfAborted()
    externalSignal?.addEventListener('abort', abort, { once: true })
    this.generations.set(generationId, controller)
    const assembler = new BlockAssembler()
    try {
      const defaultSelection = this.owner.agentDefaultModel.currentSelection()
      const input = { ...object(params.config), ...params }
      if (presentCustomEndpoint(input)) throw new Error('辅助生成必须选择已配置的原生连接；临时端点请先通过原生配置服务保存。')
      const provider = text(input.provider, defaultSelection.provider), model = text(input.model, defaultSelection.model)
      const selection = await this.owner.llm.resolveCallConfig({ provider, model,
        ...(typeof input.reasoningEffort === 'string' ? { reasoningEffort: ReasoningEffortId(input.reasoningEffort) } :
          input.reasoningEffort === undefined && defaultSelection.reasoningEffort !== undefined ? { reasoningEffort: defaultSelection.reasoningEffort } : {}) })
      const messages: GenerateOptions['messages'] = []
      const supplied = params.messages ?? params.prompts
      const rawMessages = supplied === undefined ? [{ role: 'user', content: text(params.prompt, text(params.user_input)) }] : array(supplied)
      for (const value of rawMessages) {
        const message = object(value), role = text(message.role, 'user')
        if (typeof message.content !== 'string' && !Array.isArray(message.content)) throw new TypeError('辅助生成消息 content 必须是文本或纯文本块数组。')
        const content = typeof message.content === 'string' ? message.content : array(message.content).map(block => {
          const item = object(block)
          if (item.type !== 'text' || typeof item.text !== 'string') throw new Error('辅助生成目前接收纯文本消息；图片请使用原生会话图片流程。')
          return item.text
        }).join('\n')
        if (role === 'system') messages.push(createSystemMessage(content))
        else if (role === 'user') messages.push(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: content }] }))
        else if (role === 'assistant') messages.push(createAssistantMessage({ source: { provider, model }, content: [{ type: 'text', text: content }] }))
        else throw new Error(`辅助生成不接受未说明来源的消息角色：${role}`)
      }
      if (!messages.length) throw new Error('辅助生成消息列表不能为空。')
      const options: GenerateOptions = { ...selection, messages, signal: controller.signal }
      if (typeof input.system === 'string') options.system = input.system
      for (const [key, alternative] of [['temperature', 'temperature'], ['topP', 'top_p'], ['maxTokens', 'max_tokens']] as const) {
        const value = input[key] ?? input[alternative]
        if (value !== undefined) {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || key === 'maxTokens' && (!Number.isSafeInteger(value) || value < 1)) throw new TypeError(`生成参数 ${key} 无效。`)
          options[key] = value
        }
      }
      if (input.stop !== undefined) {
        if (!Array.isArray(input.stop) || input.stop.some(item => typeof item !== 'string')) throw new TypeError('stop 必须是文本数组。')
        options.stop = input.stop as string[]
      }
      yield { kind: 'started', generationId, provider, model }
      let output = '', reasoning = '', finished = false
      for await (const chunk of this.owner.llm.stream(options)) {
        controller.signal.throwIfAborted()
        assembler.push(chunk)
        if (chunk.type === 'finish') finished = true
        if (chunk.type === 'text-delta') { output += chunk.text; yield { kind: 'delta', generationId, delta: chunk.text, text: output } }
        if (chunk.type === 'reasoning-delta') { reasoning += chunk.text; yield { kind: 'reasoning', generationId, delta: chunk.text, reasoning } }
      }
      controller.signal.throwIfAborted()
      if (!finished) throw new Error('原生模型输出流没有返回完成事件。')
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') throw Object.assign(new Error(finish.failure.message), { code: finish.failure.code })
      if (finish.kind === 'tool-calls') throw new Error('辅助生成收到工具调用；该接口没有注册工具执行器。')
      const blocks = assembler.blocks()
      yield { kind: 'finished', generationId, provider, model, text: blocks.filter(block => block.type === 'text').map(block => block.text).join(''),
        reasoning: blocks.filter(block => block.type === 'reasoning').map(block => block.text).join(''), usage: assembler.usage ?? null, finishReason: finish.kind }
    } finally {
      controller.abort(new Error('辅助生成流已关闭。'))
      this.generations.delete(generationId)
      externalSignal?.removeEventListener('abort', abort)
    }
  }

  private async extension(method: string, params: Value): Promise<unknown> {
    const manager = this.owner.get('pluginManager')
    if (!manager) throw new Error('原生插件管理服务尚未加载。')
    if (method === 'extensions.list') return manager.listBundles()
    const name = text(params.name)
    if (method === 'extensions.isInstalled') return (await manager.listBundles()).some(bundle => bundle.name === name) ||
      (await manager.listPlugins()).some(plugin => String(plugin.entryId) === name || plugin.moduleName === name)
    if (method === 'extensions.install') return manager.installBundle(text(params.url, text(params.spec)), { enabled: object(params.options).enabled !== false })
    if (method === 'extensions.uninstall') return manager.removeBundle(name)
    if (method === 'extensions.enable' || method === 'extensions.disable') {
      const enabled = method === 'extensions.enable'
      const bundles = await manager.listBundles()
      if (bundles.some(bundle => bundle.name === name)) return manager.setBundleEnabled(name, enabled)
      const plugin = (await manager.listPlugins()).find(item => String(item.entryId) === name || item.moduleName === name)
      if (!plugin) throw new Error(`原生插件不存在：${name}`)
      return manager.setPluginEnabled(plugin.entryId, enabled)
    }
    if (method === 'extensions.update') throw new Error('原生插件管理器要求明确版本安装规格；请使用 extensions.install 并传入目标版本。')
    throw new Error(`未知插件管理操作：${method}`)
  }
}

function presentCustomEndpoint(input: Value): boolean {
  return ['apiKey', 'api_key', 'baseURL', 'base_url', 'apiurl', 'custom_api'].some(key => input[key] !== undefined)
}
