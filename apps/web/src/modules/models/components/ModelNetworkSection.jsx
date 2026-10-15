import { PlusIcon, TrashIcon } from "../../../ui/icons/index.jsx";

export function ModelNetworkSection({ form, draftHeader, setDraftHeader, onUpdateField, onUpdateHeader, onAddHeader, compact = false }) {
  return (
    <section className={`model-form-section${compact ? " mobile-model-section mobile-model-network" : " model-network-section"}`}>
      <h3>{compact ? '网络' : '网络与请求头'}</h3>
      <div className={compact ? 'mobile-model-field-group' : 'model-network-fields'}>
      <label>
        <span>{compact ? '代理' : '网络代理 URL'}</span>
        <input value="" disabled title="当前 DSH 适配器使用系统代理" placeholder="使用系统代理" />
      </label>
      <div className="model-headers-editor">
        {compact && <div className="model-section-heading">
          <h4>自定义请求头</h4>
        </div>}
        {Object.entries(form.custom_headers || {}).map(([name, value]) => (
          <div className="model-header-row" key={name}>
            <input value={name} aria-label="请求头名称" readOnly />
            <input value={value} aria-label={`${name} 请求头值`} onChange={(event) => onUpdateHeader(name, name, event.target.value)} />
            <button type="button" aria-label={`删除 ${name}`} title={`删除 ${name}`} onClick={() => onUpdateHeader(name, "", "")}><TrashIcon /></button>
          </div>
        ))}
        <div className="model-header-row draft">
          <input value={draftHeader.name} onChange={(event) => setDraftHeader((current) => ({ ...current, name: event.target.value }))} placeholder="Header 名称" aria-label="新请求头名称" />
          <input value={draftHeader.value} onChange={(event) => setDraftHeader((current) => ({ ...current, value: event.target.value }))} placeholder="值" aria-label="新请求头值" />
          <button type="button" aria-label="添加请求头" title="添加请求头" onClick={onAddHeader}><PlusIcon /></button>
        </div>
      </div>
      </div>
    </section>
  );
}
