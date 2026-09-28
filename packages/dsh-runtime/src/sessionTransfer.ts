import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readDshSessionLog } from './trajectory'

export interface DshSessionArchive {
  header: SessionHeader
  inheritedEventCount: number
  events: SessionEvent[]
}

export function exportDshSession(root: string, id: string): DshSessionArchive | null {
  const stored = readDshSessionLog(root, id)
  if (!stored) return null
  return {
    header: stored.header,
    inheritedEventCount: stored.inheritedEventCount,
    events: [...stored.events] as SessionEvent[]
  }
}

export async function importDshSessions(
  root: string,
  cwd: string,
  archives: readonly DshSessionArchive[],
  ids: ReadonlyMap<string, string>
): Promise<void> {
  const persistence = new JsonlSessionPersistence(new Context(), { root, compression: 'none' })
  for (const archive of archives) {
    const id = ids.get(archive.header.id)
    if (!id) throw new Error('聊天记录缺少 DSH 会话映射。')
    const parentSession = archive.header.parentSession
    const header = {
      ...archive.header,
      id,
      cwd,
      ...(parentSession ? { parentSession: ids.get(parentSession) ?? parentSession } : {})
    } as SessionHeader
    const handle = await persistence.create(header, {
      inheritedEventCount: archive.inheritedEventCount
    })
    try {
      if (archive.events.length) await handle.append(archive.events)
      await handle.flush()
    } finally {
      await handle.close()
    }
  }
}
