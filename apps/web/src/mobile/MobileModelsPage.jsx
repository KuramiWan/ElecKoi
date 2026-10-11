import { useRef, useState, useSyncExternalStore } from 'react';
import { Plus } from '@phosphor-icons/react';
import { useMainPageView } from '../app/windows/MainPageContext.jsx';
import { ModelConfigPanel } from '../modules/models/components/ModelConfigPanel.jsx';
import { initialConfigForProvider } from '../modules/models/model/modelConfigDraft.js';
import { addableProviderItems, catalogItem, mergeProviderMeta, modelProviderSections, normalizeProviderId } from '../modules/models/model/modelProviderCatalog.js';
import { MobileDialog, MobileHeader, MobileState, useMobileScroll } from './MobileChrome.jsx';
import { MobileChevronRightIcon } from './MobileIcons.jsx';
import { MobileModelConfigDetail, MobileProviderLogo } from './MobileModelConfigDetail.jsx';
import './mobile-models.css';

function providerSummary(provider, configs) {
  if (provider.id === 'deepseek') return provider.badge;
  if (configs.length === 1) return [configs[0].name, configs[0].model].filter(value => value?.trim()).join(' · ') || provider.badge;
  return configs.length ? `${configs.length} 个配置` : provider.badge;
}

export function MobileModelsPage() {
  const view = useMainPageView();
  const { models, chat, route } = view;
  const snapshot = useSyncExternalStore(models.subscribe, models.getSnapshot);
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState('');
  const [collapsedSections, setCollapsedSections] = useState({});
  const panelRef = useRef(null);
  const ref = useMobileScroll('models', route.kind === 'root');
  function openConfig(config) { view.pushRoute({ kind: 'model-editor', configId: config.id }); }
  function create(providerId) { setPicker(false); view.pushRoute({ kind: 'model-editor', draft: initialConfigForProvider(providerId) }); }
  if (route.kind === 'model-editor') {
    const config = route.draft || snapshot.configs.find(item => item.id === route.configId);
    return <div className="mobile-root-page mobile-model-editor">
      {config ? <ModelConfigPanel ref={panelRef} config={config} configs={snapshot.configs} providers={[]} modelOptionsByKey={chat.modelOptionsByKey}
        navigationGuardRef={view.guardRef} onSave={draft => models.save(draft)} onRevealApiKey={id => models.revealApiKey(id)}
        onDeleteConfig={id => models.deleteConfig(id)} onDeleteProvider={(provider, preferredId) => models.deleteProvider(provider, preferredId)}
        onFetchModels={draft => models.discover(draft)} onProbeModels={draft => models.discover(draft)} onTestConnection={draft => models.testConnection(draft)}
        onNotify={chat.notify} renderLayout={view.renderLayout} showHeader={false}
        renderDetail={detail => <MobileModelConfigDetail {...detail} />}
        renderEditor={(editor, detail) => <><MobileHeader title="模型配置" back={view.goBack}>
          <button type="button" className="mobile-model-save" disabled={!editor.canSave} aria-busy={editor.saving || undefined} onClick={editor.onSave}>保存</button>
        </MobileHeader>{detail}</>} /> : <><MobileHeader title="模型配置" back={view.goBack} /><MobileState error={snapshot.error || '模型配置已不存在，请返回模型列表'} /></>}
    </div>;
  }
  const providers = mergeProviderMeta([], snapshot.configs);
  return <div className="mobile-root-page"><MobileHeader title="模型" onSearch={view.openSearch} onAdd={() => setPicker(true)} addLabel="添加模型提供商" />
    <div className="mobile-scroll mobile-model-list" ref={ref}>
      {modelProviderSections.map(section => {
        const sectionProviders = providers.filter(provider => provider.section === section.id);
        if (!sectionProviders.length) return null;
        const collapsed = Boolean(collapsedSections[section.id]);
        return <section key={section.id} aria-label={section.label}><h2><button type="button" className="mobile-model-group" aria-expanded={!collapsed} aria-controls={`mobile-model-group-${section.id}`} onClick={() => setCollapsedSections(current => ({ ...current, [section.id]: !current[section.id] }))}>
          <MobileChevronRightIcon size={17} /><span>{section.label}</span>
        </button></h2><div id={`mobile-model-group-${section.id}`} hidden={collapsed}>
        {sectionProviders.map(provider => {
          const configs = snapshot.configs.filter(config => normalizeProviderId(config.provider) === provider.id);
          return <div key={provider.id}><button type="button" className="mobile-provider-row" onClick={() => {
            if (!configs.length) create(provider.id);
            else if (configs.length === 1) openConfig(configs[0]);
            else setExpanded(expanded === provider.id ? '' : provider.id);
          }} aria-expanded={configs.length > 1 ? expanded === provider.id : undefined}><span className="mobile-provider-logo-seat"><MobileProviderLogo provider={provider} /></span><span className="mobile-provider-copy"><strong>{provider.label}</strong><small>{providerSummary(provider, configs)}</small></span><MobileChevronRightIcon /></button>
            {configs.length > 1 && expanded === provider.id && <div className="mobile-provider-configs">{configs.map(config => <button type="button" key={config.id} onClick={() => openConfig(config)}><strong>{config.name || config.model || '未命名配置'}</strong><MobileChevronRightIcon size={18} /></button>)}<button type="button" onClick={() => create(provider.id)}><Plus size={18} />新建配置</button></div>}
          </div>;
        })}
      </div></section>;
      })}
      <MobileState error={snapshot.error} loading={snapshot.status === 'loading'} onRetry={() => models.refresh().catch(error => chat.notify('error', error.message))} />
    </div>
    {picker && <MobileDialog title="添加模型提供商" onClose={() => setPicker(false)}><div className="mobile-picker-list">{[catalogItem('custom'), ...addableProviderItems([])].map(provider => <button type="button" key={provider.id} onClick={() => create(provider.id)}><MobileProviderLogo provider={provider} /><span>{provider.label}</span><MobileChevronRightIcon /></button>)}</div></MobileDialog>}
  </div>;
}
