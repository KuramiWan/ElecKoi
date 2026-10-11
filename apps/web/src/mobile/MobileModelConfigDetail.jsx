import { ModelBasicConfigSection } from '../modules/models/components/ModelBasicConfigSection.jsx';
import { ModelImageParametersSection } from '../modules/models/components/ModelImageParametersSection.jsx';
import { ModelNetworkSection } from '../modules/models/components/ModelNetworkSection.jsx';
import { ModelParametersSection } from '../modules/models/components/ModelParametersSection.jsx';
import { ProviderLogo } from '../modules/models/components/ProviderLogo.jsx';
import projectLogo from '../assets/eleckoi-app-icon.png';
import { MobileManualModel, MobileModelPicker } from './MobileModelPicker.jsx';

export function MobileProviderLogo({ provider }) {
  const appearance = provider.id === 'custom' ? { ...provider, icon: projectLogo, monochrome: false } : provider;
  return <ProviderLogo provider={appearance} className="mobile-provider-logo" />;
}

export function MobileModelConfigDetail({ activeProvider, isImageProvider, basicEditor, parameterEditor, networkEditor }) {
  return <section className="model-config-detail mobile-model-config-detail">
    <div className="model-detail-body">
      <div className="mobile-model-provider-card"><MobileProviderLogo provider={activeProvider} /><div><strong>{activeProvider.label}</strong><small>{activeProvider.badge}</small></div></div>
      <form className="model-detail-form" onSubmit={event => event.preventDefault()}>
        <ModelBasicConfigSection editor={basicEditor} compact
          renderModelPicker={editor => editor.modelMenuOpen ? <MobileModelPicker editor={editor} /> : null}
          renderManualModel={editor => editor.manualModelOpen ? <MobileManualModel editor={editor} /> : null} />
        {isImageProvider ? <ModelImageParametersSection form={parameterEditor.form} validationMessage={parameterEditor.imageParameterError} onChange={parameterEditor.onUpdateImageSettings} />
          : <ModelParametersSection {...parameterEditor} compact showReasoningProfileEditor onChange={parameterEditor.onUpdateModelOption} />}
        <ModelNetworkSection {...networkEditor} compact />
      </form>
    </div>
  </section>;
}
