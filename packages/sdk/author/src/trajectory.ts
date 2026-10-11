export interface AuthorTrajectoryBlock {
  type: string
  [field: string]: unknown
}

export type AuthorTrajectoryAssistantBlock =
  | { kind: 'text' | 'reasoning'; text: string }
  | { kind: 'tool-call'; callId: string; name: string; argsRaw: string }
  | { kind: 'image'; attachment: unknown }
  | { kind: 'other'; block: unknown }

export interface AuthorTrajectoryRequestConfig {
  provider: string
  model: string
  purpose?: string
  thinking?: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  stop?: readonly string[]
}

export interface AuthorTrajectoryPrompt {
  config: AuthorTrajectoryRequestConfig
  system: string
  tools: readonly unknown[]
}

export interface AuthorTrajectoryToolResult {
  kind: 'tool-result'
  seq: number
  time: number
  callId: string
  parentCallId?: string
  call: { name: string; argsRaw: string } | null
  callTime: number | null
  content: readonly AuthorTrajectoryBlock[]
  isError: boolean
  error?: { name: string; code: string; reason?: string }
  meta?: unknown
  subCalls: readonly AuthorTrajectoryTool[]
}

export type AuthorTrajectoryRunningTool = {
  callId: string
  parentCallId?: string
  name: string
  turn: number
  step: number
  time: number
  subCalls: readonly AuthorTrajectoryTool[]
} & ({ phase: 'preparing' } | { phase: 'start'; argsRaw: string })

export type AuthorTrajectoryTool = AuthorTrajectoryToolResult | AuthorTrajectoryRunningTool

export type AuthorAgentTrajectoryRecord =
  | { kind: 'user' | 'steering'; seq: number; time: number; content: readonly AuthorTrajectoryBlock[]; source: unknown; messageId?: string }
  | { kind: 'context'; seq: number; time: number; content: readonly AuthorTrajectoryBlock[]; source: unknown; producer: unknown; form: unknown }
  | { kind: 'assistant'; seq: number; time: number; messageId?: string; turn: number; step: number;
    blocks: readonly AuthorTrajectoryAssistantBlock[]; usage?: unknown; interrupted?: true;
    providerMetadata?: { provider: string; model: string }; requestConfig?: AuthorTrajectoryRequestConfig;
    timing?: { stepStartTime: number | null; firstTokenTime: number | null; completedTime: number } }
  | AuthorTrajectoryToolResult
  | { kind: 'model-retry'; seq: number; time: number; retryState: 'scheduled' | 'started' | 'cancelled'; [field: string]: unknown }
  | { kind: 'turn-error'; seq: number; time: number; turn: number; step: number; message: string; code?: string }
  | { kind: 'turn-max-tokens'; seq: number; time: number; turn: number; step: number }
  | { kind: 'command'; seq: number; time: number; commandId: string; name: string | null; args: string | null;
    outcome: { kind: 'success' | 'error'; text?: string; sourceEventSeq?: number } | null }
  | { kind: 'compaction'; seq: number; time: number; summary: string | null; summaryEventSeq: number | null;
    shadowedItemCount: number | null; shadowedTokenCount: number | null }
  | { kind: 'unknown'; seq: number; time: number; type: string; data: unknown }

export type AuthorAgentTrajectoryRequest = {
  startSeq: number
  startedAt: number
  completedAt: number | null
  status: 'running' | 'complete' | 'error'
  error?: string
  errorCode?: string
  providerMetadata?: { provider: string; model: string }
  requestConfig?: AuthorTrajectoryRequestConfig
  usage?: unknown
  resultSeq?: number
} & (
  | { purpose: 'assistant'; turn: number; step: number; prompt?: AuthorTrajectoryPrompt;
    promptChange?: { seq: number; time: number; kind: 'initial' | 'system' | 'tools' | 'system-and-tools'; previous?: AuthorTrajectoryPrompt };
    retry?: number; maxRetries?: number; retryDelayMs?: number }
  | { purpose: 'compaction'; turn: number | null; step: 0; replacementSeq?: number;
    summary?: readonly AuthorTrajectoryBlock[]; rawOutput?: readonly AuthorTrajectoryBlock[] }
)

export type AuthorTrajectoryLocation =
  | { kind: 'session' | 'unresolved' }
  | { kind: 'turn'; turn: number; turnStatus: 'open' | 'closed' | 'unknown' }
  | { kind: 'step'; turn: number; step: number; turnStatus: 'open' | 'closed' | 'unknown'; stepStatus: 'open' | 'closed' | 'unknown' }

/** A copied loaded-history view, not another persisted trajectory or request cache. */
export interface AuthorAgentTrajectory {
  conversationId: string
  runtimeSessionId: string
  history: { hasMore: boolean; beforeSequence: number | null }
  snapshot: {
    events: readonly AuthorAgentTrajectoryRecord[]
    locations: ReadonlyMap<number, AuthorTrajectoryLocation>
    requests: readonly AuthorAgentTrajectoryRequest[]
    toolSchemas: ReadonlyMap<string, unknown>
    systemPrompts?: readonly { seq: number; time: number; turn: number; step: number; text: string; update: boolean }[]
    partial: { turn: number; step: number; blocks: readonly AuthorTrajectoryAssistantBlock[] } | null
    runningTools: readonly AuthorTrajectoryRunningTool[]
  }
}
