import type { VariableItemConfig, VariableObjectConfig } from '@shared/contracts/variables/schemas'
import { variableItemConfigSchema, variableObjectConfigSchema } from '@shared/contracts/variables/schemas'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'

export const VARIABLE_INITIAL_STATE_CONTENT_KIND = 'initial_state'
export const VARIABLE_SCHEMA_CODE_CONTENT_KIND = 'schema_code'

export function readVariableObject(payloadJson: string): VariableObjectConfig {
  try {
    return variableObjectConfigSchema.parse(JSON.parse(payloadJson))
  } catch (error) {
    throw new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, '变量组数据已损坏。', { what: '变量组数据' })
  }
}

export function readVariable(payloadJson: string): VariableItemConfig {
  try {
    return variableItemConfigSchema.parse(JSON.parse(payloadJson))
  } catch (error) {
    throw new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt, '变量数据已损坏。', { what: '变量数据' })
  }
}

export function writeVariableObject(value: VariableObjectConfig): string {
  return JSON.stringify(variableObjectConfigSchema.parse(value))
}

export function writeVariable(value: VariableItemConfig): string {
  return JSON.stringify(variableItemConfigSchema.parse(value))
}
