async function loadActivePreset(presetCatalog) {
  const catalog = await presetCatalog.refresh();
  const preset = await presetCatalog.read(catalog.activePresetId);
  return { catalog, preset };
}

function chatModelConfigs(configs) {
  return configs.filter((config) => config.enabled !== false);
}

function asToolCatalog(preset, configs) {
  return {
    characterId: '',
    scopeId: `agent-preset:${preset.id}`,
    groups: preset.toolGroups.filter((group) => group.included),
    modelConfigs: chatModelConfigs(configs),
    subagentModelSelection: preset.subagentModelSelection,
    roleplayPlan: preset.roleplayPlan,
  };
}

export async function loadAgentTools(presetCatalog, configs = []) {
  const { preset } = await loadActivePreset(presetCatalog);
  return asToolCatalog(preset, configs);
}

export async function setAgentToolGroupEnabled(presetCatalog, groupId, enabled, configs = []) {
  const { preset } = await loadActivePreset(presetCatalog);
  const saved = await presetCatalog.save({
      ...preset,
      toolGroups: preset.toolGroups.map((group) => group.id === groupId ? { ...group, included: true, enabled } : group),
  }, preset.regexRules);
  return asToolCatalog(saved, configs);
}

export async function setSubagentModelSelection(presetCatalog, selection, configs = []) {
  const { preset } = await loadActivePreset(presetCatalog);
  const saved = await presetCatalog.save({ ...preset, subagentModelSelection: selection }, preset.regexRules);
  return asToolCatalog(saved, configs);
}

export async function setRoleplayPlanSettings(presetCatalog, roleplayPlan, configs = []) {
  const { preset } = await loadActivePreset(presetCatalog);
  const saved = await presetCatalog.save({ ...preset, roleplayPlan }, preset.regexRules);
  return asToolCatalog(saved, configs);
}
