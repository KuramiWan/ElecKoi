export default ({ api }) => api.ui.registerButton({
  id: 'clear-draft',
  label: '清空输入框',
  async onClick({ api }) { await api.input.clear(); },
});
