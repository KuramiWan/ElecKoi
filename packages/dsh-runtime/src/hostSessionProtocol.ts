import type { DshInputFile } from './types'

export type HostPromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string; name?: string }

export interface HostRunRequest {
  type: 'run'
  id: string
  sessionId: string
  cwd: string
  selection: { provider: string; model: string; reasoningEffort?: string }
  content: HostPromptPart[]
  files: DshInputFile[]
}

export type ParentHostMessage =
  | HostRunRequest
  | { type: 'create'; id: string; sessionId: string; cwd: string }
  | { type: 'cancel'; id: string; sessionId: string }
  | { type: 'dispose'; id: string; sessionId: string }
  | { type: 'rewind'; id: string; sessionId: string; fromTurn: number }
  | { type: 'edit-message'; id: string; sessionId: string; messageId: string; role: 'user' | 'assistant'; content: string }
  | { type: 'reconfigure'; id: string; providerPatchPath?: string; credentials: Record<string, string> }
  | { type: 'shutdown' }

export type ChildHostMessage =
  | { type: 'ready'; url: string; injections: readonly unknown[] }
  | { type: 'fatal'; message: string }
  | { type: 'shutdown-complete' }
  | { type: 'run-notification'; id: string; method: string; params: Record<string, unknown> }
  | { type: 'run-complete'; id: string; finalResponse: string }
  | { type: 'run-failed'; id: string; message: string }
  | { type: 'create-complete'; id: string; message?: string }
  | { type: 'cancel-complete'; id: string; cancelled: boolean; message?: string }
  | { type: 'dispose-complete'; id: string; disposed: boolean; message?: string }
  | { type: 'rewind-complete'; id: string; cut?: number; unavailable?: boolean; message?: string }
  | { type: 'edit-message-complete'; id: string; message?: string }
  | { type: 'reconfigure-complete'; id: string; message?: string }
