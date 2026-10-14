import { installTavernCompatibility } from '@eleckoi/tavern-native'
import type { AuthorHostAdapter } from '@eleckoi/author-sdk/browser'

export interface TavernRemote {
  snapshot(conversationId: string): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
  invoke(conversationId: string, method: string, params: Record<string, unknown>): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
}
export interface TavernDocumentContext { conversationId: string; messageId?: string; characterId?: string; scriptId?: string }
export interface TavernDocumentMount { conversationId: string; ready: Promise<void>; refresh(): Promise<unknown>; dispose(): void }

/** One owner bridges its native API and accepted host snapshot into each browser realm. */
export function mountTavernDocument(target: Window, options: {
  remote: TavernRemote; shared: object; context: TavernDocumentContext; adapter: AuthorHostAdapter;
  available(): void; report(error: unknown): void;
  ui: { formatMessage(text: string, options?: Record<string, unknown>): Promise<string>;
    refreshMessage(index: string | number, options?: Record<string, unknown>): Promise<void> }
}): TavernDocumentMount {
  const lifetime = new AbortController()
  const available = () => { lifetime.signal.throwIfAborted(); options.available() }
  const unwrap = async (request: ReturnType<TavernRemote['snapshot']>) => {
    const result = await request
    available()
    if (!result.ok) throw new Error(result.error?.message || 'Tavern compatibility host request failed.')
    return result.value as Record<string, unknown>
  }
  const controller = installTavernCompatibility(target, {
    bridge: {
      snapshot: () => { available(); return unwrap(options.remote.snapshot(options.context.conversationId)) },
      invoke: (method: string, params: Record<string, unknown>) => {
        available(); return unwrap(options.remote.invoke(options.context.conversationId, method, params))
      },
    },
    shared: options.shared, context: options.context,
    native: {
      request: async (method: string, params: Record<string, unknown>) => {
        available(); return options.adapter.request(method, params, { signal: lifetime.signal })
      },
      subscribe: (event: string, listener: (payload: unknown) => void) => options.adapter.on(event, listener),
    },
    ui: options.ui, report: options.report,
  })
  const close = () => {
    if (lifetime.signal.aborted) return
    lifetime.abort(new Error('Tavern compatibility document closed'))
    target.removeEventListener('pagehide', close)
    controller.dispose()
  }
  target.addEventListener('pagehide', close, { once: true })
  return { conversationId: options.context.conversationId, ready: controller.ready, refresh: () => { available(); return controller.refresh() }, dispose: close }
}
