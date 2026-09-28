import { ConversationList } from "../../../src/renderer/src/modules/chat/index.js";
import { RoleplayPanel } from "../../../src/renderer/src/app/windows/RoleplayPanel.jsx";
import { useMainPageView } from "../../../src/renderer/src/app/windows/MainPageContext.jsx";

export function MessagesPage() {
  const view = useMainPageView();
  const { chat, appearance, conversations, renderRoleplay, renderLayout, selectConversation, openChatBackground, openPresetTools, openCharacterSection } = view;
  return renderLayout({
    sidePanel: <ConversationList
      keyword={chat.keyword}
      setKeyword={chat.setKeyword}
      sessions={chat.filteredSessions}
      sessionId={chat.sessionId}
      pinnedIds={chat.pinnedIds}
      characters={chat.characters}
      artworkMode={appearance.sidebarCharacterArtwork}
      onLoadChat={selectConversation}
      onOpenCharacterChat={chat.openCharacterChat}
      onGoCharacterSettings={openCharacterSection}
      onTogglePinChat={chat.togglePinChat}
      onOpenChatWindow={chat.openChatWindow}
      onHideChat={chat.hideChatEntry}
    />,
    mainPanel: <RoleplayPanel
      renderRoleplay={renderRoleplay}
      hasActiveChat={Boolean(chat.sessionId || chat.chatCharacter?.character_id)}
      conversationId={chat.sessionId}
      runtimeSessionId={chat.runtimeSessionId}
      conversationModel={conversations}
      hasCharacters={Boolean(chat.characters?.items?.length)}
      currentTitle={chat.currentTitle}
      persona={chat.chatPersona}
      messages={chat.messages}
      input={chat.input}
      setInput={chat.setInput}
      inputImages={chat.inputImages}
      inputFiles={chat.inputFiles}
      filesUploading={chat.filesUploading}
      fileUploadProgress={chat.fileUploadProgress}
      onAddImages={chat.addInputImages}
      onAddFiles={chat.addInputFiles}
      onRemoveImage={chat.removeInputImage}
      onRemoveFile={chat.removeInputFile}
      isSending={chat.isSending}
      modelConfigs={chat.chatModelConfigs}
      selectedModelConfigId={chat.selectedChatModelConfigId}
      selectedModel={chat.selectedChatModel}
      modelOptionsByKey={chat.modelOptionsByKey}
      onLoadModelOptions={chat.loadModelOptions}
      onSelectModel={chat.selectChatModel}
      onSaveModelConfig={chat.saveModelConfig}
      onNotify={chat.notify}
      onSend={chat.sendMessage}
      onStop={chat.stopSend}
      onCreateChat={chat.createChat}
      onOpenHistory={chat.openHistory}
      onOpenChatBackground={openChatBackground}
      onOpenPresetTools={openPresetTools}
      onRegenerate={chat.regenerateReply}
      onDeleteMessages={chat.deleteMessagesFrom}
      onEditMessage={chat.editMessage}
      onEditOpening={chat.editOpening}
      onSelectOpening={chat.selectOpening}
      onGoCharacterSettings={openCharacterSection}
      scrollRef={chat.scrollRef}
      scrollRequest={chat.scrollRequest}
      hasOlderMessages={chat.hasOlderMessages}
      isLoadingOlderMessages={chat.isLoadingOlderMessages}
      onLoadOlderMessages={chat.loadOlderMessages}
      chatDisplay={appearance.chatDisplay}
    />,
  });
}
