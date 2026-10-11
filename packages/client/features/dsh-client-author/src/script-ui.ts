import { AuthorApiError, readAuthorDocumentDeclaration, type AuthorScriptPanel } from '@eleckoi/author-sdk'
import type { AuthorHostAdapter } from '@eleckoi/author-sdk/browser'
import type { NativeAuthorScript, NativeAuthorScriptIdentity } from '@eleckoi/dsh-product-api/types'
import type { NativeAuthorUiSnapshot, NativeAuthorPanel } from './client/types.js'
import type { AuthorBrowserWindow } from './frame.js'

export interface NativeScriptUiOwner {
  conversationId: string
  version: string
  script: NativeAuthorScript
  identity: NativeAuthorScriptIdentity
  registerButton: NonNullable<AuthorHostAdapter['registerButton']>
  request(method: string, params: Record<string, unknown>): unknown
  dispose(): void
}
interface Button {
  key: string; id: string; label: string; owner: NativeScriptUiOwner
  onClick: Parameters<NonNullable<AuthorHostAdapter['registerButton']>>[0]['onClick']
  abort: AbortController; busy: boolean; error: string
}

/** Live UI registrations belong to an exact script generation, never to a display name. */
export class NativeScriptUi {
  private snapshot: NativeAuthorUiSnapshot = { buttons: [], panel: null }
  private readonly listeners = new Set<() => void>()
  private readonly owners = new Set<NativeScriptUiOwner>()
  private readonly buttons = new Map<string, Button>()
  private panel: { view: NativeAuthorPanel; owner: NativeScriptUiOwner; closes: Set<() => void> } | undefined

  constructor(private readonly options: {
    window: AuthorBrowserWindow
    available(owner: NativeScriptUiOwner): void
    report(error: unknown): void
  }) {}

  getSnapshot = (): NativeAuthorUiSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  createOwner(conversationId: string, version: string, script: NativeAuthorScript): NativeScriptUiOwner {
    const owner: NativeScriptUiOwner = { conversationId, version, script,
      identity: { scope: script.scope, ownerId: script.ownerId, scriptId: script.id },
      registerButton: value => {
        this.check(owner)
        const key = JSON.stringify([script.key, value.id])
        if (this.buttons.has(key)) throw new AuthorApiError('BUTTON_ID_CONFLICT', `同一脚本的按钮编号重复：${value.id}`)
        const button: Button = { ...value, key, owner, abort: new AbortController(), busy: false, error: '' }
        this.buttons.set(key, button); this.publish()
        return () => {
          if (this.buttons.get(key) !== button) return
          button.abort.abort(new AuthorApiError('BUTTON_CLOSED', '脚本按钮已撤下'))
          this.buttons.delete(key); this.publish()
        }
      },
      request: (method, params) => {
        this.check(owner)
        if (method === 'ui.openPanel') return this.open(owner, params as unknown as AuthorScriptPanel)
        if (method === 'ui.closePanel') {
          if (typeof params.id !== 'string' || !params.id.trim()) throw new AuthorApiError('INVALID_PARAMS', '作者面板编号不能为空')
          return { closed: this.panel?.owner === owner && this.panel.view.id === params.id ? this.dismissPanel(this.panel.view.key) : false }
        }
        throw new AuthorApiError('UI_UNAVAILABLE', `脚本界面方法未接通：${method}`)
      },
      dispose: () => {
        if (!this.owners.delete(owner)) return
        for (const button of this.buttons.values()) if (button.owner === owner) {
          button.abort.abort(new AuthorApiError('SCRIPT_CLOSED', '所属脚本已停用'))
          this.buttons.delete(button.key)
        }
        if (this.panel?.owner === owner) this.dismissPanel(this.panel.view.key)
        this.publish()
      }
    }
    this.owners.add(owner)
    return owner
  }

  async invokeButton(key: string): Promise<void> {
    const button = this.buttons.get(key)
    if (!button || !button.owner.script.buttonsVisible) throw new AuthorApiError('BUTTON_UNAVAILABLE', '这个脚本按钮已不可用')
    this.check(button.owner); this.options.available(button.owner)
    if (button.busy) throw new AuthorApiError('BUTTON_BUSY', '这个脚本按钮正在执行')
    button.busy = true; button.error = ''; this.publish()
    const signal = button.abort.signal
    let cancel = () => {}
    try {
      await new Promise<void>((resolve, reject) => {
        cancel = () => reject(signal.reason)
        signal.addEventListener('abort', cancel, { once: true })
        Promise.resolve().then(() => { signal.throwIfAborted(); return button.onClick(signal) }).then(resolve, reject)
      })
      signal.throwIfAborted()
    } catch (error) {
      if (!signal.aborted && this.buttons.get(key) === button) {
        button.error = error instanceof Error ? error.message : String(error)
        this.options.report(error)
      }
      throw error
    } finally {
      signal.removeEventListener('abort', cancel)
      if (this.buttons.get(key) === button) { button.busy = false; this.publish() }
    }
  }

  dismissPanel(key: string): boolean {
    if (!this.panel || this.panel.view.key !== key) return false
    const panel = this.panel; this.panel = undefined
    for (const close of panel.closes) close()
    this.publish(); return true
  }

  mountPanel(key: string, mount: (owner: NativeScriptUiOwner) => () => void): () => void {
    const panel = this.panel
    if (!panel || panel.view.key !== key) throw new AuthorApiError('PANEL_CLOSED', '作者面板已关闭或被替换')
    this.check(panel.owner); this.options.available(panel.owner)
    const close = mount(panel.owner)
    const release = () => { if (panel.closes.delete(release)) close() }
    panel.closes.add(release)
    return release
  }

  close(): void {
    for (const owner of this.owners) owner.dispose()
    if (this.panel) this.dismissPanel(this.panel.view.key)
  }

  dispose(): void { this.close(); this.listeners.clear() }

  private open(owner: NativeScriptUiOwner, panel: AuthorScriptPanel): { id: string } {
    if (typeof panel.id !== 'string' || !panel.id.trim() || typeof panel.title !== 'string' || !panel.title.trim()
      || typeof panel.html !== 'string' || !panel.html.trim()) throw new AuthorApiError('INVALID_PARAMS', '作者面板需要 id、title 和原生 HTML 文档')
    const selected = readAuthorDocumentDeclaration(panel.html, new this.options.window.DOMParser())
    if (selected.kind !== 'native') throw new AuthorApiError('INVALID_DOCUMENT', selected.kind === 'unsupported' ? selected.error : '作者面板没有声明原生 SDK 版本')
    if (this.panel) this.dismissPanel(this.panel.view.key)
    const view: NativeAuthorPanel = { id: panel.id, title: panel.title, html: panel.html, key: this.options.window.crypto.randomUUID(),
      conversationId: owner.conversationId, scriptKey: owner.script.key, baseUrl: owner.script.entryUrl }
    this.panel = { owner, view, closes: new Set() }; this.publish()
    return { id: panel.id }
  }

  private check(owner: NativeScriptUiOwner): void {
    if (!this.owners.has(owner)) throw new AuthorApiError('SCRIPT_CLOSED', '所属脚本已停用')
  }
  private publish(): void {
    this.snapshot = { panel: this.panel?.view ?? null, buttons: [...this.buttons.values()]
      .filter(button => button.owner.script.buttonsVisible)
      .map(({ key, id, label, busy, error, owner }) => ({ key, id, label, busy, error, scriptKey: owner.script.key,
        scriptName: owner.script.name, scope: owner.script.scope, conversationId: owner.conversationId })) }
    for (const listener of this.listeners) listener()
  }
}
