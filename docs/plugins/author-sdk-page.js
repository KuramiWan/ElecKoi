for (const table of document.querySelectorAll('table')) {
  const wrapper = document.createElement('div'); wrapper.className = 'table-scroll';
  table.replaceWith(wrapper); wrapper.append(table);
}
const search = document.querySelector('#api-search');
search.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase();
  let count = 0;
  for (const method of document.querySelectorAll('.api-method')) {
    method.hidden = !!query && !method.dataset.search.toLocaleLowerCase().includes(query);
    if (!method.hidden) count++;
  }
  for (const namespace of document.querySelectorAll('.api-namespace')) {
    namespace.hidden = !namespace.querySelector('.api-method:not([hidden])');
  }
  document.querySelector('#guide').hidden = document.querySelector('#types').hidden = !!query;
  document.querySelector('#search-status').textContent = query ? `找到 ${count} 个接口` : '';
});
document.querySelector('nav').addEventListener('click', event => {
  if (!event.target.closest('a') || !search.value) return;
  search.value = '';
  search.dispatchEvent(new Event('input'));
});
