import { DEFAULT_NOVELAI_COMPILER_INSTRUCTION, MAX_STORY_IMAGES, NOVELAI_SAMPLERS } from '@shared/contracts/agent/novelAiImageSettings';
import './model-image-parameters.css';

const OPENAI_QUALITIES = [
  { id: "auto", label: "自动" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

const OPENAI_BACKGROUNDS = [
  { id: "auto", label: "自动" },
  { id: "opaque", label: "不透明" },
  { id: "transparent", label: "透明" },
];

function numberValue(raw) {
  return raw === "" ? "" : Number(raw);
}

export function ModelImageParametersSection({ form, validationMessage, onChange }) {
  const settings = form.image_settings || {};
  const openAi = form.provider === "openai_image";
  const update = (key, value) => onChange({ ...settings, [key]: value });

  return (
    <>
    {!openAi && <section className="model-form-section">
      <h3>剧情分镜数量</h3>
      <div className="model-parameter-grid">
        <label><span>数量模式</span><select value={settings.automaticImageCount ? 'automatic' : 'fixed'} onChange={event => update('automaticImageCount', event.target.value === 'automatic')}><option value="fixed">固定数量</option><option value="automatic">自动数量</option></select></label>
        {settings.automaticImageCount ? <>
          <label><span>最少分镜数</span><input type="number" min="1" max={MAX_STORY_IMAGES} value={settings.automaticImageMin ?? 1} onChange={event => update('automaticImageMin', numberValue(event.target.value))} /></label>
          <label><span>最多分镜数</span><input type="number" min="1" max={MAX_STORY_IMAGES} value={settings.automaticImageMax ?? 6} onChange={event => update('automaticImageMax', numberValue(event.target.value))} /></label>
        </> : <label><span>每轮分镜数</span><input type="number" min="1" max={MAX_STORY_IMAGES} value={settings.fixedImageCount ?? 1} onChange={event => update('fixedImageCount', numberValue(event.target.value))} /></label>}
      </div>
    </section>}
    <section className="model-form-section">
      <h3>绘画参数</h3>
      <div className="model-parameter-grid">
        <label>
          <span>宽度</span>
          <input type="number" min={openAi ? 16 : 512} max={openAi ? 3840 : 2048} step={openAi ? 16 : 1} value={settings.width ?? ""} onChange={(event) => update("width", numberValue(event.target.value))} />
        </label>
        <label>
          <span>高度</span>
          <input type="number" min={openAi ? 16 : 512} max={openAi ? 3840 : 2048} step={openAi ? 16 : 1} value={settings.height ?? ""} onChange={(event) => update("height", numberValue(event.target.value))} />
        </label>
        {openAi ? (
          <>
            <label>
              <span>质量</span>
              <select value={settings.quality || "auto"} onChange={(event) => update("quality", event.target.value)}>
                {OPENAI_QUALITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span>背景</span>
              <select value={settings.background || "auto"} onChange={(event) => update("background", event.target.value)}>
                {OPENAI_BACKGROUNDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              <span>步数</span>
              <input type="number" min="1" max="50" value={settings.steps ?? ""} onChange={(event) => update("steps", numberValue(event.target.value))} />
            </label>
            <label>
              <span>提示词相关性</span>
              <input type="number" min="0.1" max="10" step="0.1" value={settings.scale ?? ""} onChange={(event) => update("scale", numberValue(event.target.value))} />
            </label>
            <label>
              <span>采样器</span>
              <select value={settings.sampler || "k_euler_ancestral"} onChange={(event) => update("sampler", event.target.value)}>
                {NOVELAI_SAMPLERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      {validationMessage ? <p className="model-parameter-error">{validationMessage}</p> : null}
    </section>
    {!openAi && <section className="model-form-section">
      <h3>提示词</h3>
      <div className="model-parameter-grid novelai-prompt-fields">
        <label><span>提示词编译指令</span><textarea rows={5} maxLength={8000} value={settings.promptCompilerInstruction ?? ''} placeholder={DEFAULT_NOVELAI_COMPILER_INSTRUCTION} onChange={event => update('promptCompilerInstruction', event.target.value)} /></label>
        <label><span>全局固定词</span><textarea rows={3} maxLength={4000} value={settings.promptPrefix ?? ''} onChange={event => update('promptPrefix', event.target.value)} /></label>
        <label><span>负面追加词</span><textarea rows={3} maxLength={2000} value={settings.negativePrompt ?? ''} onChange={event => update('negativePrompt', event.target.value)} /></label>
      </div>
    </section>}
    </>
  );
}
