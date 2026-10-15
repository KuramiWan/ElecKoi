const files = '**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'

// A suite declares the preparation required by its actual runtime, not its filename.
export const testSuites = {
  unit: { include: [`packages/shared/tests/${files}`, `packages/sdk/*/tests/${files}`, `packages/compatibility/*/tests/${files}`] },
  ui: { include: [`apps/web/tests/${files}`, `packages/client/*/*/tests/client/${files}`], exclude: ['apps/web/tests/browser/**'] },
  host: { include: [`packages/host/*/tests/${files}`, `packages/client/*/*/tests/host/${files}`, `apps/desktop-host/tests/${files}`], runtime: true, sqlite: true },
  desktop: { include: [`apps/desktop/tests/${files}`], runtime: true },
  android: { include: [`apps/android/tests/${files}`, `apps/android-host/tests/${files}`, `scripts/android-runtime/tests/${files}`] },
  tooling: { include: [`scripts/tests/${files}`] },
  browser: { include: [`apps/web/tests/browser/${files}`], runtime: true },
  integration: { include: [`tests/integration/${files}`], runtime: true, sqlite: true },
}

export function selectTestSuite(name) {
  if (name === 'all') return { runtime: true, sqlite: true }
  if (!Object.hasOwn(testSuites, name)) throw new Error(`未知测试分组：${name}。可用分组：${Object.keys(testSuites).join('、')}、all`)
  return testSuites[name]
}
