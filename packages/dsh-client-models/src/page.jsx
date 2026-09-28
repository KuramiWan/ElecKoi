import { ModelConfigPanel } from "../../../src/renderer/src/modules/models/index.js";

export function ModelPage({ view }) {
  const { chat, modelConfigPanelRef, setModelConfigDirty, renderLayout } = view;
  return <ModelConfigPanel
    ref={modelConfigPanelRef}
    config={chat.modelConfig}
    configs={chat.modelConfigs}
    providers={chat.meta?.providers || []}
    modelOptionsByKey={chat.modelOptionsByKey}
    onSave={chat.saveModelConfig}
    onDeleteConfig={chat.deleteModelConfig}
    onDeleteProvider={chat.deleteModelProvider}
    onFetchModels={chat.loadModelOptions}
    onProbeModels={chat.probeModelOptions}
    onTestConnection={chat.testModelConnection}
    onNotify={chat.notify}
    onDirtyChange={setModelConfigDirty}
    renderLayout={renderLayout}
  />;
}
