import { describe, expect, it } from 'vitest'
import { isParentHostMessage } from '../src/hostSessionProtocol'

describe('Android lifecycle control admission', () => {
  it('rejects coerced actions before they can bypass the update lock', () => {
    expect(isParentHostMessage({ type: 'update-tasks', id: 'request', action: ['lock'] })).toBe(false)
    expect(isParentHostMessage({ type: 'update-tasks', id: 'request', action: { toString: () => 'lock' } })).toBe(false)
    expect(isParentHostMessage({ type: 'update-tasks', id: 'request', action: 'lock' })).toBe(true)
  })
  it('rejects unrecognized fields and missing request identity', () => {
    expect(isParentHostMessage({ type: 'shutdown', action: 'unlock' })).toBe(false)
    expect(isParentHostMessage({ type: 'update-tasks', id: '', action: 'inspect' })).toBe(false)
    expect(isParentHostMessage({ type: 'update-tasks', id: 'request', action: 'other' })).toBe(false)
    expect(isParentHostMessage({ type: 'shutdown' })).toBe(true)
  })
})
