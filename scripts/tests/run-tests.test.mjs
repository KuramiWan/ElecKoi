import { describe, expect, it } from 'vitest'
import { runTests } from '../run-tests.mjs'

function execution(statuses = []) {
  const calls = []
  return { calls, run: async (args, options) => { calls.push({ args, restoring: options?.restoring === true }); return statuses.shift() ?? 0 } }
}

describe('test command preparation and failure handling', () => {
  it.each(['unit', 'ui', 'android', 'tooling'])('runs %s directly without building or replacing native binaries', async name => {
    const f = execution()
    expect(await runTests(name, ['synthetic.test.js'], f.run)).toBe(0)
    expect(f.calls).toEqual([{ args: ['exec', 'vitest', 'run', '--project', name, 'synthetic.test.js'], restoring: false }])
  })
  it('restores Electron after a failed database test and preserves the failing exit code', async () => {
    const f = execution([0, 0, 7, 0])
    expect(await runTests('host', [], f.run)).toBe(7)
    expect(f.calls.map(call => call.args[0])).toEqual(['build:workspace-runtime', 'rebuild:node', 'exec', 'rebuild:electron'])
    expect(f.calls.at(-1).restoring).toBe(true)
  })
  it('restores a partially replaced native binary even when preparation fails', async () => {
    const f = execution([0, 9, 0])
    expect(await runTests('integration', [], f.run)).toBe(9)
    expect(f.calls.map(call => call.args[0])).toEqual(['build:workspace-runtime', 'rebuild:node', 'rebuild:electron'])
  })
  it('does not continue to native preparation or tests after a failed build', async () => {
    const f = execution([3])
    expect(await runTests('all', [], f.run)).toBe(3)
    expect(f.calls).toHaveLength(1)
  })
  it('restores Electron and reports cancellation without starting tests', async () => {
    let cancelled = false
    const f = execution()
    const run = async (args, options) => { const status = await f.run(args, options); if (args[0] === 'rebuild:node') cancelled = true; return status }
    expect(await runTests('host', [], run, () => cancelled)).toBe(130)
    expect(f.calls.map(call => call.args[0])).toEqual(['build:workspace-runtime', 'rebuild:node', 'rebuild:electron'])
  })
  it('fails explicitly if Electron restoration fails, including after an execution exception', async () => {
    const f = execution([0, 0, 0, 5])
    await expect(runTests('host', [], f.run)).rejects.toThrow('恢复失败')
    const commands = []
    await expect(runTests('host', [], async args => {
      commands.push(args[0])
      if (args[0] === 'exec') throw new Error('synthetic launch failure')
      return 0
    })).rejects.toThrow('synthetic launch failure')
    expect(commands.at(-1)).toBe('rebuild:electron')
  })
  it('rejects unknown suites and project overrides before running any command', async () => {
    const f = execution()
    await expect(runTests('unknown', [], f.run)).rejects.toThrow('未知测试分组')
    await expect(runTests('ui', ['--project=host'], f.run)).rejects.toThrow('不要覆盖')
    expect(f.calls).toEqual([])
  })
})
