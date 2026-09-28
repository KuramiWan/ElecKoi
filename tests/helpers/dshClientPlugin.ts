export function dshClientPlugin(registration: { factory: (...args: any[]) => any }) {
  const plugin = registration.factory((name: string) => {
    if (name === 'react') return { createElement: () => null }
    throw new Error(`Unexpected client module ${name}`)
  })
  return {
    apply: (context: Record<string, unknown>) => plugin.apply({
      slots: { inject: () => {} },
      ...context,
    }),
  }
}
