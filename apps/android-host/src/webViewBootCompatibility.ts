/** Runs as a classic head script before the official client boot gate. Keep it self-contained. */
function installWebViewBootCompatibility(): void {
  if (typeof Promise.withResolvers !== 'function') {
    Object.defineProperty(Promise, 'withResolvers', {
      configurable: true, writable: true,
      value: function withResolvers<T>(this: PromiseConstructor) {
        let resolve: ((value: T | PromiseLike<T>) => void) | undefined
        let reject: ((reason?: unknown) => void) | undefined
        const promise = new this<T>((resolvePromise, rejectPromise) => {
          if (resolve !== undefined || reject !== undefined) throw new TypeError('Promise executor already initialized')
          resolve = resolvePromise
          reject = rejectPromise
        })
        if (typeof resolve !== 'function' || typeof reject !== 'function') {
          throw new TypeError('Promise constructor did not provide resolve and reject')
        }
        return { promise, resolve, reject }
      }
    })
  }
  if (typeof AbortSignal.any !== 'function') {
    const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!
    const controllers = new WeakMap<AbortSignal, AbortController>()
    const subscriptions = new FinalizationRegistry<() => void>(dispose => dispose())

    function subscribe(source: AbortSignal, result: WeakRef<AbortSignal>, dispose: () => void): () => void {
      return () => {
        const signal = result.deref()
        if (signal === undefined) { dispose(); return }
        if (!aborted.call(source)) return
        const controller = controllers.get(signal)!
        dispose()
        subscriptions.unregister(signal)
        controllers.delete(signal)
        controller.abort(source.reason)
      }
    }

    Object.defineProperty(AbortSignal, 'any', {
      configurable: true, writable: true,
      value: function any(inputs: Iterable<AbortSignal>): AbortSignal {
        if (inputs === null || (typeof inputs !== 'object' && typeof inputs !== 'function')) {
          throw new TypeError('AbortSignal.any requires an iterable sequence of signals')
        }
        // Convert the complete input sequence before considering an already aborted source.
        const sources = new Set<AbortSignal>()
        for (const source of inputs) {
          aborted.call(source)
          sources.add(source)
        }
        const controller = new AbortController()
        for (const source of sources) {
          if (aborted.call(source)) {
            controller.abort(source.reason)
            return controller.signal
          }
        }
        if (sources.size === 0) return controller.signal
        const signal = controller.signal
        controllers.set(signal, controller)
        const result = new WeakRef(signal)
        const listeners = new Map<AbortSignal, () => void>()
        const dispose = () => {
          for (const [source, listener] of listeners) source.removeEventListener('abort', listener)
          listeners.clear()
        }
        for (const source of sources) {
          const listener = subscribe(source, result, dispose)
          listeners.set(source, listener)
          source.addEventListener('abort', listener)
        }
        // An abandoned request must not leave its subscriptions on a long-lived connection.
        subscriptions.register(signal, dispose, signal)
        return signal
      }
    })
  }
}

export const WEBVIEW_BOOT_COMPATIBILITY_SCRIPT = `(${installWebViewBootCompatibility.toString()})();`
