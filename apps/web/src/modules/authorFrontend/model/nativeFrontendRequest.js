import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';

/** UI commands map only to the generated native project service. */
export async function requestNativeFrontend(service, owner, method, params = {}) {
  if (!service) throw new DesktopError(ELECKOI_FAILURE_CODES.lifecycleNotReady, '原生前端插件未启用', { what: '原生前端插件' });
  const remote = service.projects;
  const result = await invoke();
  // 直接抛失败对象：码与详情逐字保留；折叠按结构标记识别，不需要 Error 实例。
  if (!result.ok) throw result.error;
  return result.value;
  function invoke() {
  switch (method) {
    case 'frontends.workspace': return remote.workspace(owner);
    case 'frontends.import': return remote.importProject(owner, params);
    case 'frontends.select': return remote.select(owner, params.projectId);
    case 'frontends.delete': return remote.delete(owner, params.projectId);
    case 'frontends.readFile': return remote.readFile(owner, params.projectId, {
      ...(params.path !== undefined ? { path: params.path } : {}), ...(params.encoding !== undefined ? { encoding: params.encoding } : {}),
    });
    case 'frontends.writeFile': return remote.writeFile(owner, params.projectId, {
      path: params.path, content: params.content, ...(params.encoding !== undefined ? { encoding: params.encoding } : {}),
    });
    case 'frontends.export': return remote.exportProject(owner, params.projectId);
    case 'frontends.setMessageRenderer': return remote.setMessageRenderer(owner, params.enabled);
    case 'frontends.updateProject': return remote.updateProject(owner, params.projectId, params.patch);
    case 'frontends.replaceFiles': return remote.replaceFiles(owner, params.projectId, {
      files: params.files, ...(params.deletePaths !== undefined ? { deletePaths: params.deletePaths } : {}),
      ...(params.entryFile !== undefined ? { entryFile: params.entryFile } : {}), ...(params.manifest !== undefined ? { manifest: params.manifest } : {}),
    });
    case 'frontends.restoreDefault': return remote.restoreDefault(owner);
    default: throw new DesktopError(ELECKOI_FAILURE_CODES.internal, `未知的原生前端操作：${method}`, { what: '原生前端操作' });
  }
  }
}
