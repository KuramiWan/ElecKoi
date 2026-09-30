import { ModelConfigPanel } from "../../../src/renderer/src/modules/models/index.js";
import { useMainPageView } from "../../../src/renderer/src/app/windows/MainPageContext.jsx";
export { ModelNavIcon as NavigationIcon } from "../../../src/renderer/src/ui/icons/navIcons.jsx";

export function ModelPage() {
  const view = useMainPageView();
  const { chat, modelConfigPanelRef, setModelConfigDirty, renderModelEditor, renderLayout } = view;
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
    renderEditor={renderModelEditor}
    renderLayout={renderLayout}
  />;
}
