export default context => context.api.ui.registerButton({
  id: 'brief-mode',
  label: '切换简洁回复',
  async onClick({ api }) {
    const preset = await api.presets.current();
    if (!preset || preset.id !== context.ownerId) throw new Error('所属预设已不再是当前预设');
    const { briefEntryId, detailedEntryId } = context.settings;
    if (typeof briefEntryId !== 'string' || typeof detailedEntryId !== 'string') {
      throw new Error('请在脚本设置中提供两个明确的预设条目编号');
    }
    const brief = await api.presets.getEntry(preset.id, briefEntryId);
    await api.presets.updateEntries(preset.id, [
      { id: briefEntryId, changes: { enabled: !brief.enabled } },
      { id: detailedEntryId, changes: { enabled: brief.enabled } },
    ]);
  },
});
