import { useState, useSyncExternalStore } from 'react';
import { CheckCircle, Eye, EyeSlash, SpinnerGap, Trash } from '../../../ui/icons/interfaceIcons.jsx';
import { useWebSearchModel } from '../model/WebSearchContext.jsx';

const RESULT_COUNTS = [3, 5, 8];

export function WebSearchSettings() {
  const model = useWebSearchModel();
  const settings = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function update(patch) {
    if (settings.status !== 'ready' || busy) return;
    setBusy('settings');
    setNotice('');
    setError('');
    try {
      await model.update(patch);
    } catch (cause) {
      setError(messageOf(cause, '保存联网搜索配置失败'));
    } finally {
      setBusy('');
    }
  }

  async function saveAndTest() {
    if (busy) return;
    const value = apiKey.trim();
    if (!value) {
      setError('请先填写 Tavily API Key');
      return;
    }
    setBusy('save');
    setNotice('');
    setError('');
    try {
      const result = await model.saveAndTest(value);
      setApiKey('');
      setNotice(connectionText(result.connection, 'API Key 已保存'));
    } catch (cause) {
      setError(messageOf(cause, 'Tavily 连接失败'));
    } finally {
      setBusy('');
    }
  }

  async function testConnection() {
    if (busy) return;
    setBusy('test');
    setNotice('');
    setError('');
    try {
      const result = await model.test(apiKey);
      setNotice(connectionText(result.connection, 'Tavily 连接正常'));
    } catch (cause) {
      setError(messageOf(cause, 'Tavily 连接失败'));
    } finally {
      setBusy('');
    }
  }

  async function removeKey() {
    if (busy) return;
    setBusy('remove');
    setNotice('');
    setError('');
    try {
      await model.removeKey();
      setApiKey('');
      setNotice('已移除 Tavily API Key');
    } catch (cause) {
      setError(messageOf(cause, '移除 Tavily API Key 失败'));
    } finally {
      setBusy('');
    }
  }

  if (settings.status !== 'ready') {
    return <div className="web-search-config-state" aria-live="polite">{error || settings.error || '正在读取配置'}</div>;
  }

  return <div className="web-search-config" aria-busy={Boolean(busy)}>
    <fieldset className="web-search-config-fieldset">
      <legend>搜索方式</legend>
      <div className="web-search-mode" role="group" aria-label="搜索方式">
        <button type="button" disabled={!settings.writable || Boolean(busy)} aria-pressed={settings.mode === 'provider_native'} onClick={() => update({ mode: 'provider_native' })}>
          <strong>模型原生</strong><span>DeepSeek 官方</span>
        </button>
        <button type="button" disabled={!settings.writable || !settings.tavilyAvailable || Boolean(busy)} aria-pressed={settings.mode === 'tavily'} onClick={() => update({ mode: 'tavily' })}>
          <strong>Tavily</strong><span>{settings.apiKeyConfigured ? '已配置' : '需要 API Key'}</span>
        </button>
        <button type="button" disabled={!settings.writable || !settings.deepseek.available || Boolean(busy)} aria-pressed={settings.mode === 'deepseek_api'} onClick={() => update({ mode: 'deepseek_api' })}>
          <strong>DeepSeek Search</strong><span>独立搜索 API</span>
        </button>
      </div>
    </fieldset>

    <fieldset className="web-search-config-fieldset">
      <legend>网页抓取</legend>
      <div className="web-search-mode" role="group" aria-label="网页抓取方式">
        {['http', 'deepseek_api'].map(mode => <button key={mode} type="button" aria-pressed={settings.fetchMode === mode} disabled={!settings.writable || Boolean(busy) || (mode === 'deepseek_api' && !settings.deepseek.available)} onClick={() => update({ fetchMode: mode })}>
          <strong>{mode === 'http' ? '直接抓取' : 'DeepSeek Fetch'}</strong><span>{mode === 'http' ? '本机访问网页' : '官方网页解析 API'}</span>
        </button>)}
      </div>
    </fieldset>

    {settings.mode === 'deepseek_api' || settings.fetchMode === 'deepseek_api' ? <DeepSeekSettings settings={settings} model={model} busy={Boolean(busy)} update={update} /> : null}

    {settings.mode === 'tavily' ? <fieldset className="web-search-config-fieldset">
      <legend>API Key</legend>
      <div className="web-search-key-field">
        <input
          type={showKey ? 'text' : 'password'}
          name="tavily-api-key"
          autoComplete="off"
          value={apiKey}
          maxLength={2048}
          placeholder={settings.apiKeyConfigured ? '已保存，填写可替换' : '填写 Tavily API Key'}
          aria-label="Tavily API Key"
          disabled={!settings.apiKeyWritable || Boolean(busy)}
          onChange={(event) => { setApiKey(event.target.value); setNotice(''); setError(''); }}
          onKeyDown={(event) => { if (event.key === 'Enter') saveAndTest(); }}
        />
        <button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey((value) => !value)}>
          {showKey ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      <div className="web-search-key-actions">
        {apiKey.trim() ? <button type="button" className="is-primary" disabled={!settings.apiKeyWritable || Boolean(busy)} onClick={saveAndTest}>
          {busy === 'save' ? <SpinnerGap className="is-spinning" aria-hidden="true" /> : <CheckCircle aria-hidden="true" />}保存并测试
        </button> : null}
        {settings.apiKeyConfigured ? <button type="button" disabled={Boolean(busy)} onClick={testConnection}>
          {busy === 'test' ? <SpinnerGap className="is-spinning" aria-hidden="true" /> : null}测试连接
        </button> : null}
        {settings.apiKeyConfigured ? <button type="button" className="is-danger" disabled={!settings.apiKeyWritable || Boolean(busy)} onClick={removeKey}>
          <Trash aria-hidden="true" />移除
        </button> : null}
      </div>
    </fieldset> : null}

    {settings.mode === 'tavily' ? <fieldset className="web-search-config-fieldset">
      <legend>返回结果</legend>
      <div className="web-search-results" role="group" aria-label="返回结果数量">
        {RESULT_COUNTS.map((count) => <button type="button" disabled={!settings.writable || Boolean(busy)} aria-pressed={settings.maxResults === count} key={count} onClick={() => update({ maxResults: count })}>{count} 条</button>)}
      </div>
    </fieldset> : null}

    {notice || error ? <div className={`web-search-config-message${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{notice || error}</div> : null}
  </div>;
}

function messageOf(error, fallback) {
  return typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : fallback;
}

function connectionText(connection, prefix) {
  return connection.limit > 0
    ? `${prefix} · ${connection.plan} · ${connection.used} / ${connection.limit} credits`
    : `${prefix} · ${connection.plan}`;
}

function DeepSeekSettings({ settings, model, busy, update }) {
  const config = settings.deepseek;
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const disabled = pending || busy;
  async function action(kind) {
    if (disabled) return;
    setPending(true); setMessage(''); setError('');
    try {
      if (kind === 'remove') { await model.removeKey('deepseek_api'); setMessage('已移除 DeepSeek 联网 API Key'); }
      else if (kind === 'save') { await model.saveAndTest(key, 'deepseek_api'); setMessage('已保存，Search 和 Fetch 均连接正常'); }
      else { await model.test(key, 'deepseek_api'); setMessage('Search 和 Fetch 均连接正常'); }
      setKey('');
    } catch (cause) { setError(messageOf(cause, 'DeepSeek 联网连接失败')); }
    finally { setPending(false); }
  }
  return <>
    <fieldset className="web-search-config-fieldset" disabled={disabled}>
      <legend>DeepSeek 联网 API Key</legend>
      <div className="web-search-key-field">
        <input type={visible ? 'text' : 'password'} autoComplete="off" name="deepseek-web-api-key" aria-label="DeepSeek 联网 API Key" placeholder={config.apiKeyConfigured ? '已保存，填写可替换' : '填写 DeepSeek API Key'} value={key} disabled={!config.apiKeyWritable} onChange={event => { setKey(event.target.value); setError(''); setMessage(''); }} onKeyDown={event => { if (event.key === 'Enter' && key.trim()) action('save'); }} />
        <button type="button" aria-label={visible ? '隐藏 DeepSeek API Key' : '显示 DeepSeek API Key'} onClick={() => setVisible(value => !value)}>{visible ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
      </div>
      <div className="web-search-key-actions">
        {key.trim() ? <button type="button" disabled={!config.apiKeyWritable} onClick={() => action('save')}>保存并测试</button> : null}
        {config.apiKeyConfigured ? <button type="button" onClick={() => action('test')}>测试连接</button> : null}
        {config.apiKeyConfigured ? <button type="button" className="is-danger" disabled={!config.apiKeyWritable} onClick={() => action('remove')}>移除</button> : null}
      </div>
      <p className="web-search-config-message">搜索和抓取均按官方 API 计费；连接测试会各调用一次。此密钥单独保存，不改聊天模型密钥。</p>
      <label className="web-search-option">凭据引用<input aria-label="DeepSeek 联网凭据引用" defaultValue={config.apiKeyRef} key={config.apiKeyRef} disabled={!settings.writable} onBlur={event => { if (event.target.value !== config.apiKeyRef) update({ deepseekKeyRef: event.target.value }); }} /></label>
    </fieldset>
    {settings.mode === 'deepseek_api' ? <fieldset className="web-search-config-fieldset" disabled={disabled || !settings.writable}>
      <legend>DeepSeek 搜索结果</legend>
      <label className="web-search-option">每次返回条数<input type="number" min="1" max="50" step="1" aria-label="DeepSeek 每次返回条数" key={config.count} defaultValue={config.count} onBlur={event => { const value = Number(event.target.value); if (value !== config.count) update({ deepseekCount: value }); }} /></label>
      <label className="web-search-option"><span>同时获取网页正文</span><input type="checkbox" checked={config.needContent} onChange={event => update({ needContent: event.target.checked })} /></label>
      <label className="web-search-option">地域 IP（可留空）<input aria-label="DeepSeek 搜索地域 IP" defaultValue={config.localization} key={config.localization} onBlur={event => { if (event.target.value !== config.localization) update({ localization: event.target.value }); }} /></label>
    </fieldset> : null}
    {pending || message || error ? <div className={`web-search-config-message${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message || '正在测试 Search 和 Fetch…'}</div> : null}
  </>;
}
