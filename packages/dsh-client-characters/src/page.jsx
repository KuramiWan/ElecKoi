import { CharacterListPanel, CharacterProfilePanel, openCharacterEditorWindow } from "../../../src/renderer/src/modules/persona/index.js";
import { useMainPageView } from "../../../src/renderer/src/app/windows/MainPageContext.jsx";

export function CharacterPage() {
  const view = useMainPageView();
  const { chat, appearance, renderLayout } = view;
  return renderLayout({
    sidePanel: <CharacterListPanel
      characters={chat.characters}
      activeCharacterId={chat.selectedCharacterId || chat.characters.active_character_id}
      artworkMode={appearance.sidebarCharacterArtwork}
      onSelectCharacter={chat.selectCharacter}
      onOpenCharacterChat={chat.openCharacterChat}
      onSaveCharacterGroups={chat.saveCharacterGroups}
      onImportPreparedCharacters={chat.importPreparedCharacters}
      onCreateCharacter={chat.createCharacter}
      onDeleteCharacters={chat.deleteCharacterIds}
    />,
    mainPanel: <CharacterProfilePanel
      characters={chat.characters}
      selectedCharacterId={chat.selectedCharacterId}
      onSelectCharacter={chat.selectCharacter}
      onStartConversation={chat.openCharacterChat}
      onEditCharacter={openCharacterEditorWindow}
      onCreateFirstCharacter={() => chat.createCharacter()}
    />,
  });
}
