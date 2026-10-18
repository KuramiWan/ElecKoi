import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';
import { useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { useFrontendWorkspace } from '../hooks/useFrontendWorkspace.js';
import { characterFrontendEntry } from '../model/characterFrontend.js';
import { AdvancedFrontendFrame } from './AdvancedFrontendFrame.jsx';
import '../styles/characterFrontend.css';

export function CharacterFrontendView({ characterId, conversationId, fallback }) {
  const { workspace, status, error, request } = useFrontendWorkspace(characterId);
  const [restoreError, setRestoreError] = useState(''), [restoring, setRestoring] = useState(false);
  if (status === 'unavailable' || status === 'loading' || !characterId || !conversationId) return fallback;
  if (!workspace.selectedProjectId && !error) return fallback;
  const project = workspace.projects.find(item => item.id === workspace.selectedProjectId);
  let entryFile, failure = error;
  if (!failure) {
    try { if (!project) throw new DesktopError(ELECKOI_FAILURE_CODES.lookupNotFound, '已选择的角色前端项目不存在', { what: '角色前端项目' }); entryFile = characterFrontendEntry(project, characterId); }
    catch (reason) { failure = reason.message; }
  }
  const restore = async () => {
    setRestoring(true);
    try { await request('frontends.restoreDefault'); setRestoreError(''); }
    catch (reason) { setRestoreError(reason.message); }
    finally { setRestoring(false); }
  };
  return <section className="character-frontend-project" aria-label="角色前端">
    <header><span role={failure || restoreError ? 'alert' : undefined}>{failure || restoreError}</span>
      <button type="button" disabled={restoring} onClick={restore} title="恢复默认对话界面" aria-label="恢复默认对话界面"><ArrowCounterClockwise size={18} /></button></header>
    {!failure && <AdvancedFrontendFrame nativeOnly project={project} entryFile={entryFile} request={request} revision={workspace.revision}
      context={{ view: 'chat', binding: { target: 'root' }, owner: { characterId, conversationId } }} />}
  </section>;
}
