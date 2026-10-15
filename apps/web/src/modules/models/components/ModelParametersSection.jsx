import { reasoningEffortIds, reasoningEffortLabel, reasoningOptions } from "../model/modelReasoningOptions.js";

function optionalNumber(value) {
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function compactTokens(value) {
  return value >= 1000 ? `${Number((value / 1000).toFixed(3))}K` : String(value);
}

export function ModelParametersSection({ form, activeModelOption, automaticContextWindow, effectiveContextWindow, parameterError, modelCapabilities, showReasoningProfileEditor = false, compact = false, onChange }) {
  const options = reasoningOptions(modelCapabilities.reasoningEfforts);
  const selectedEffort = options.some((item) => item.id === activeModelOption?.reasoningEffort)
    ? activeModelOption.reasoningEffort
    : "";
  const reasoningAvailable = modelCapabilities.reasoningEfforts.length > 0;
  const inheritsCapabilities = form.builtin && form.useBuiltinModels !== false && activeModelOption?.capabilitiesOverride !== true;
  const inputModalities = activeModelOption?.inputModalities || (activeModelOption?.supportsImageInput ? ['text', 'image'] : ['text']);

  function toggleModality(modality, checked) {
    const next = checked ? [...inputModalities.filter(item => item !== modality), modality] : inputModalities.filter(item => item !== modality);
    onChange({ inputModalities: next, supportsImageInput: next.includes('image') });
  }

  function updateReasoningEffort(value) {
    onChange({
      reasoningEffort: value || null,
    });
  }

  function toggleReasoningEffort(effort) {
    const current = activeModelOption?.reasoningEfforts && typeof activeModelOption.reasoningEfforts === "object"
      ? activeModelOption.reasoningEfforts
      : {};
    const next = { ...current };
    if (Object.hasOwn(next, effort)) delete next[effort];
    else next[effort] = effort === "off" ? null : effort;
    const selectedRemoved = activeModelOption?.reasoningEffort === effort && !Object.hasOwn(next, effort);
    onChange({
      reasoningEfforts: Object.keys(next).length ? next : undefined,
      ...(selectedRemoved ? { reasoningEffort: null } : {}),
    });
  }
  return (
    <section className={`model-form-section${compact ? " mobile-model-section mobile-model-parameters" : ""}`}>
      <div className="model-section-heading">
        <h3>{compact ? "参数" : "模型参数"}</h3>
        {!compact && <span>{form.model ? `仅作用于 ${form.model}` : "先选择模型后设置"}</span>}
      </div>
      <div className="model-parameter-grid">
        <label>
          <span>上下文窗口 <small>{compact ? `= ${compactTokens(effectiveContextWindow)}` : `自动 ${automaticContextWindow.toLocaleString()}`}</small></span>
          <input type="number" min="4096" max="4000000" disabled={!form.model} value={activeModelOption?.contextWindowTokens ?? ""} onChange={(event) => onChange({ contextWindowTokens: optionalNumber(event.target.value) })} placeholder={String(automaticContextWindow)} />
        </label>
        <label>
          <span>自动压缩阈值 <small>{compact ? `= ${compactTokens(activeModelOption?.autoCompactTokenLimit ?? Math.floor(effectiveContextWindow * 0.8))} · ${activeModelOption?.autoCompactTokenLimit == null ? '占上下文 80%' : '自定义'}` : '默认占上下文 80%'}</small></span>
          <input type="number" min="1024" max={effectiveContextWindow} disabled={!form.model} value={activeModelOption?.autoCompactTokenLimit ?? ""} onChange={(event) => onChange({ autoCompactTokenLimit: optionalNumber(event.target.value) })} placeholder={`${compact ? '自动 ' : ''}${Math.floor(effectiveContextWindow * 0.8)}`} />
        </label>
        <label>
          <span>单次最大输出 <small>{compact && activeModelOption?.maxOutputTokens != null ? `= ${compactTokens(activeModelOption.maxOutputTokens)}` : '留空由上游决定'}</small></span>
          <input type="number" min="1" max="4000000" disabled={!form.model} value={activeModelOption?.maxOutputTokens ?? ""} onChange={(event) => onChange({ maxOutputTokens: optionalNumber(event.target.value) })} placeholder="自动" />
        </label>
        <label>
          <span>推理强度 <small>当前请求</small></span>
          <select disabled={!form.model || !reasoningAvailable} value={selectedEffort} onChange={(event) => updateReasoningEffort(event.target.value)}>
            {options.map((effort) => <option key={effort.id} value={effort.id}>{compact && !effort.id ? '上游默认' : effort.label}</option>)}
          </select>
        </label>
        <label>
          <span>温度 <small>{compact ? '留空不发送' : '0–2'}</small></span>
          <input type="number" min="0" max="2" step="0.01" disabled={!form.model} value={activeModelOption?.temperature ?? ""} onChange={(event) => onChange({ temperature: optionalNumber(event.target.value) })} placeholder={compact ? '留空' : '上游默认'} />
        </label>
        <label>
          <span>Top P <small>{compact ? '留空不发送' : '0–1'}</small></span>
          <input type="number" min="0" max="1" step="0.01" disabled={!form.model} value={activeModelOption?.topP ?? ""} onChange={(event) => onChange({ topP: optionalNumber(event.target.value) })} placeholder={compact ? '留空' : '上游默认'} />
        </label>
      </div>
      <div className="model-capabilities">
        <div className="model-capabilities-heading">
          <span>模型能力声明</span>
          {form.builtin && form.useBuiltinModels !== false && <label className="model-capability-toggle">
            <input type="checkbox" disabled={!form.model} checked={inheritsCapabilities} onChange={event => onChange({ capabilitiesOverride: !event.target.checked })} />
            <span>使用目录默认</span>
          </label>}
        </div>
        <fieldset className="model-input-capabilities" aria-label="输入能力" disabled={!form.model || inheritsCapabilities}>
          <div>
            <label><input type="checkbox" checked={inputModalities.includes('text')} onChange={event => toggleModality('text', event.target.checked)} />文本</label>
            <label><input type="checkbox" checked={inputModalities.includes('image')} onChange={event => toggleModality('image', event.target.checked)} />图片</label>
          </div>
        </fieldset>
        {showReasoningProfileEditor && modelCapabilities.canDeclareReasoning ? (
          <fieldset className="model-reasoning-profile" disabled={!form.model || inheritsCapabilities}>
            <legend>
              <span>支持推理档位</span>
            </legend>
            <div className="model-reasoning-efforts">
              {reasoningEffortIds.map((effort) => {
                const selected = modelCapabilities.reasoningEfforts.includes(effort);
                return (
                  <button
                    key={effort}
                    className={selected ? "selected" : ""}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${selected ? "取消" : "声明支持"}${reasoningEffortLabel(effort)}档位`}
                    onClick={() => toggleReasoningEffort(effort)}
                  >
                    {reasoningEffortLabel(effort)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </div>
      {parameterError ? <p className="model-parameter-error">上下文需为 4,096–4,000,000；压缩不能超过上下文；输出需为 1–4,000,000；温度为 0–2，Top P 为 0–1；已声明推理能力时至少选择一个非关闭档位。</p> : null}
      {activeModelOption?.inputModalities?.length === 0 && <p className="model-parameter-error">至少选择一种输入能力。</p>}
    </section>
  );
}
