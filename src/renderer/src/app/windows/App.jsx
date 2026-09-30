import { MainWindow } from "./MainWindow.jsx";
import { ChatWindow } from "./ChatWindow.jsx";
import { CharacterEditorWindow } from "./CharacterEditorWindow.jsx";
import { CharacterManagerWindow } from "./CharacterManagerWindow.jsx";
import { CreatorStudioWindow } from "./CreatorStudioWindow.jsx";
import { PresetManagerWindow } from "./PresetManagerWindow.jsx";

export default function App({ conversations, characters, characterConfiguration, models, persona, presets, settingsSections, navigation, renderSettingsSection, renderUserProfileEditor, renderCharacterPageSection, renderCharacterEditorSection, renderCharacterManager, renderConversationList, renderPresetEditorSection, renderPresetManager, renderModelEditor, renderRoleplay } = {}) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "chat") {
    return <ChatWindow conversations={conversations} characters={characters} models={models} persona={persona} renderRoleplay={renderRoleplay} />;
  }
  if (params.get("view") === "character-editor") {
    return <CharacterEditorWindow characterCatalog={characters} characterConfiguration={characterConfiguration} renderCharacterEditorSection={renderCharacterEditorSection} />;
  }
  if (params.get("view") === "character-manager") {
    return <CharacterManagerWindow characterCatalog={characters} personaModel={persona} renderCharacterManager={renderCharacterManager} />;
  }
  if (params.get("view") === "preset-manager") {
    return <PresetManagerWindow presetCatalog={presets} renderPresetManager={renderPresetManager} />;
  }
  if (params.get("view") === "creator-studio") {
    return <CreatorStudioWindow characterCatalog={characters} />;
  }

  return <MainWindow conversations={conversations} characters={characters} models={models} persona={persona} presets={presets}
    settingsSections={settingsSections} navigation={navigation} renderSettingsSection={renderSettingsSection}
    renderUserProfileEditor={renderUserProfileEditor} renderCharacterPageSection={renderCharacterPageSection}
    renderConversationList={renderConversationList} renderPresetEditorSection={renderPresetEditorSection}
    renderModelEditor={renderModelEditor} renderRoleplay={renderRoleplay} />;
}
