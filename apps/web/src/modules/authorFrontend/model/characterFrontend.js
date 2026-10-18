import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';

/** A character project owns the chat content region, not the application shell. */
export function characterFrontendEntry(project, characterId) {
  if (!project) throw new DesktopError(ELECKOI_FAILURE_CODES.lookupNotFound, '角色前端项目不存在', { what: '角色前端项目' });
  if (project.scope !== 'character' || project.characterId !== characterId || project.manifest?.scope !== 'character') {
    throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, '前端项目不属于当前角色', { what: '前端项目与所属角色' });
  }
  const manifest = project.manifest;
  if (manifest.manifestVersion !== 1 || !/^(0\.1\.|1\.)/.test(manifest.sdkVersion || '')) throw new DesktopError(ELECKOI_FAILURE_CODES.inputUnsupported, '不支持的角色前端清单版本', { what: '角色前端清单版本', expected: '1' });
  const bindings = manifest.bindings || [];
  if (bindings.length > 1 || bindings.some(binding => binding.target !== 'root' || binding.view && binding.view !== 'chat')) {
    throw new DesktopError(ELECKOI_FAILURE_CODES.inputUnsupported, '角色前端目前只支持聊天内容区；不能接管应用页面或其他插槽', { what: '角色前端的挂载位置', expected: '聊天内容区' });
  }
  const entryFile = bindings.length ? bindings[0].entryFile : manifest.entryFile;
  if (!entryFile || !project.files.includes(entryFile)) throw new DesktopError(ELECKOI_FAILURE_CODES.lookupNotFound, '角色前端入口文件不存在', { what: '角色前端入口文件' });
  return entryFile;
}
