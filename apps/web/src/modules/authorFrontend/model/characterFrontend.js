/** A character project owns the chat content region, not the application shell. */
export function characterFrontendEntry(project, characterId) {
  if (!project) throw new Error('角色前端项目不存在');
  if (project.scope !== 'character' || project.characterId !== characterId || project.manifest?.scope !== 'character') {
    throw new Error('前端项目不属于当前角色');
  }
  const manifest = project.manifest;
  if (manifest.manifestVersion !== 1 || !/^(0\.1\.|1\.)/.test(manifest.sdkVersion || '')) throw new Error('不支持的角色前端清单版本');
  const bindings = manifest.bindings || [];
  if (bindings.length > 1 || bindings.some(binding => binding.target !== 'root' || binding.view && binding.view !== 'chat')) {
    throw new Error('角色前端目前只支持聊天内容区；不能接管应用页面或其他插槽');
  }
  const entryFile = bindings.length ? bindings[0].entryFile : manifest.entryFile;
  if (!entryFile || !project.files.includes(entryFile)) throw new Error('角色前端入口文件不存在');
  return entryFile;
}
