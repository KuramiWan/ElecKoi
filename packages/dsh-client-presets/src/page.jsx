import { PresetListPanel, PresetProvider, PresetWorkspace } from "../../../src/renderer/src/modules/presets/index.js";
import { useMainPageView } from "../../../src/renderer/src/app/windows/MainPageContext.jsx";
export { PresetNavIcon as NavigationIcon } from "../../../src/renderer/src/ui/icons/navIcons.jsx";

export function PresetsPage() {
  const view = useMainPageView();
  const { chat, characterConfiguration, presets, presetNavigationGuardRef, presetRequestedTab, setPresetRequestedTab, renderPresetEditorSection, renderLayout } = view;
  return <PresetProvider catalogModel={presets} navigationGuardRef={presetNavigationGuardRef}>
    {renderLayout({
      sidePanel: <PresetListPanel />,
      mainPanel: <PresetWorkspace
        modelConfigs={chat.chatModelConfigs}
        modelOptionsByKey={chat.modelOptionsByKey}
        onLoadModels={chat.loadModelOptions}
        onNotify={chat.notify}
        onTestRegex={(text, rule, target) => characterConfiguration.regexRules.test(text, rule, target)}
        requestedTab={presetRequestedTab}
        onRequestedTabHandled={() => setPresetRequestedTab("")}
        renderEditorSection={renderPresetEditorSection}
      />,
    })}
  </PresetProvider>;
}
