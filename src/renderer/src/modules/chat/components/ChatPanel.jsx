import { ChatComposer } from "./ChatComposer.jsx";
import { ChatWaitingReply } from "./ChatWaitingReply.jsx";
import { ChatDropOverlay } from "./ChatDropOverlay.jsx";
import { AgentProcessDialog } from "./AgentProcessDialog.jsx";
import { TrajectoryDialog } from "./TrajectoryDialog.jsx";
import { VariableViewerDialog } from "./VariableViewerDialog.jsx";
import { AgentToolsDialog } from "./AgentToolsDialog.jsx";
import { MessageBubble } from "../../../ui/messages/MessageBubble.jsx";
import { ConfirmationDialog } from "../../../ui/ui/ConfirmationDialog.jsx";
import logoIcon from "../../../assets/eleckoi-app-icon.png";
import { DshNewChatIcon } from "../../../ui/icons/dshComposerIcons.jsx";
import { Path, SlidersHorizontal } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getGenerationStats, listenGenerationStatsEvent } from "../api/chatApi.js";
import {
  chatDisplayCssVariables,
  chatTextColorCssVariables,
  messageFloorNumber,
  resolveChatAvatar,
  resolveChatAvatarShape,
  resolveChatDisplayProfile,
} from "../../appearance/index.js";
import { findLatestRegenerateTargetMessageId } from "../model/chatRegeneration.js";
import { retainVisibleGenerationStats } from "./GenerationStats.jsx";

export function ChatPanel({
  hasActiveChat,
  hasCharacters,
  currentTitle,
  conversationId,
  conversationModel,
  persona,
  messages,
  input,
  setInput,
  inputImages = [],
  onAddImages,
  onRemoveImage,
  inputFiles = [],
  onAddFiles,
  onRemoveFile,
  filesUploading = false,
  fileUploadProgress = null,
  isSending,
  modelConfigs,
  selectedModelConfigId,
  selectedModel,
  modelOptionsByKey,
  onLoadModelOptions,
  onSelectModel,
  onSaveModelConfig,
  onNotify,
  onSend,
  onStop,
  onCreateChat,
  onOpenHistory,
  onOpenChatBackground,
  onOpenPresetTools,
  onRegenerate,
  onDeleteMessages,
  onEditMessage,
  onEditOpening,
  onSelectOpening,
  onGoCharacterSettings,
  scrollRef,
  scrollRequest = { revision: 0, behavior: "auto" },
  hasOlderMessages = false,
  isLoadingOlderMessages = false,
  onLoadOlderMessages,
  chatDisplay,
  runtimeSessionId = "",
  renderRoleplaySlot,
  renderRoleplayMessage,
}) {
  const [messageAreaHovered, setMessageAreaHovered] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [processMessage, setProcessMessage] = useState(null);
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [messageScrollElement, setMessageScrollElement] = useState(null);
  const [generationStats, setGenerationStats] = useState(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteFromMessageId, setDeleteFromMessageId] = useState("");
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const headerMenuRef = useRef(null);
  const imageDragDepthRef = useRef(0);
  const previousMessageScrollTopRef = useRef(null);
  const bindMessageScrollElement = useCallback((element) => {
    scrollRef.current = element;
    setMessageScrollElement(element);
  }, [scrollRef]);

  useEffect(() => {
    previousMessageScrollTopRef.current = null;
  }, [scrollRequest.revision]);

  useEffect(() => {
    setDeleteMode(false);
    setDeleteFromMessageId("");
    setDeletingMessages(false);
    setDeleteConfirmationOpen(false);
  }, [conversationId]);

  useEffect(() => {
    if (!deleteMode || deleteConfirmationOpen) return undefined;
    const cancelDelete = (event) => {
      if (event.key !== "Escape" || deletingMessages) return;
      setDeleteMode(false);
      setDeleteFromMessageId("");
    };
    window.addEventListener("keydown", cancelDelete);
    return () => window.removeEventListener("keydown", cancelDelete);
  }, [deleteConfirmationOpen, deleteMode, deletingMessages]);

  useEffect(() => {
    if (!headerMenuOpen) return undefined;
    const close = (event) => {
      if (!headerMenuRef.current?.contains(event.target)) {
        setHeaderMenuOpen(false);
      }
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [headerMenuOpen]);

  useEffect(() => {
    let active = true;
    setGenerationStats(null);
    if (!conversationId) return undefined;
    getGenerationStats(conversationId)
      .then((stats) => { if (active) setGenerationStats(stats); })
      .catch(() => {});
    const dispose = listenGenerationStatsEvent((event) => {
      if (active && event.conversationId === conversationId) {
        setGenerationStats((previous) => retainVisibleGenerationStats(previous, event.stats));
      }
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [conversationId]);

  const openingMessage = messages.find((item) => item.id === "opening" && item.openingOptions?.length > 1);
  useEffect(() => {
    if (!openingMessage || isSending || deleteMode || String(input || "").length || processMessage || headerMenuOpen) return undefined;
    const options = openingMessage.openingOptions || [];
    const selectedIndex = options.findIndex((item) => item.id === openingMessage.selectedOpeningId);
    const switchOpening = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
      const nextIndex = event.key === "ArrowLeft" ? selectedIndex - 1 : selectedIndex + 1;
      if (nextIndex < 0 || nextIndex >= options.length) return;
      event.preventDefault();
      const pagerButton = scrollRef.current?.querySelector(
        event.key === "ArrowLeft" ? ".has-opening-pager .opening-pager-prev" : ".has-opening-pager .opening-pager-next",
      );
      if (pagerButton instanceof HTMLButtonElement && !pagerButton.disabled) {
        pagerButton.click();
        return;
      }
      onSelectOpening?.(openingMessage, options[nextIndex].id);
    };
    window.addEventListener("keydown", switchOpening);
    return () => window.removeEventListener("keydown", switchOpening);
  }, [deleteMode, headerMenuOpen, input, isSending, onSelectOpening, openingMessage, processMessage]);

  useEffect(() => {
    if (!hasActiveChat) return undefined;
    const resetDrop = () => {
      imageDragDepthRef.current = 0;
      setImageDragActive(false);
    };
    const enterFileDrop = (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      imageDragDepthRef.current += 1;
      setImageDragActive(true);
    };
    const overFileDrop = (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = isSending ? 'none' : 'copy';
    };
    const leaveFileDrop = (event) => {
      if (!hasFileDrag(event)) return;
      imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1);
      if (imageDragDepthRef.current === 0) setImageDragActive(false);
      const outside = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
      if (outside && (event.target === document.body || event.target === document.documentElement)) resetDrop();
    };
    const receiveDrop = (event) => {
      if (!hasFileDrag(event)) return;
      event.preventDefault();
      resetDrop();
      if (isSending) return;
      const files = [...(event.dataTransfer.files || [])];
      receiveImages(files.filter((file) => file.type.startsWith('image/')));
      receiveFiles(files.filter((file) => !file.type.startsWith('image/')));
    };
    document.addEventListener('dragenter', enterFileDrop);
    document.addEventListener('dragover', overFileDrop);
    document.addEventListener('dragleave', leaveFileDrop);
    document.addEventListener('drop', receiveDrop);
    window.addEventListener('dragend', resetDrop);
    return () => {
      document.removeEventListener('dragenter', enterFileDrop);
      document.removeEventListener('dragover', overFileDrop);
      document.removeEventListener('dragleave', leaveFileDrop);
      document.removeEventListener('drop', receiveDrop);
      window.removeEventListener('dragend', resetDrop);
    };
  }, [hasActiveChat, isSending, onAddFiles, onAddImages, onNotify]);

  if (!hasActiveChat) {
    return (
      <section className="chat-panel chat-panel-empty-state" aria-label="未选择聊天">
        <div className="chat-empty-guide">
          <img src={logoIcon} alt="" draggable="false" />
          {hasCharacters ? (
            <>
              <strong>选择一个角色开始聊天</strong>
              <span>从左侧角色列表中打开一个角色后，这里会显示对话内容。</span>
            </>
          ) : (
            <>
              <strong>还没有聊天角色</strong>
              <span>先创建一个角色，再开始第一段对话。</span>
              <button type="button" onClick={onGoCharacterSettings}>去创建角色</button>
            </>
          )}
        </div>
      </section>
    );
  }

  const { layout: layoutMode, profile } = resolveChatDisplayProfile(chatDisplay);
  const avatarShape = resolveChatAvatarShape(layoutMode, profile?.avatar_shape || "portrait");
  const displayStyle = {
    ...chatDisplayCssVariables(layoutMode, profile),
    ...chatTextColorCssVariables(chatDisplay?.text_colors),
  };
  const userAvatar = resolveChatAvatar(persona, "user", avatarShape);
  const assistantAvatar = resolveChatAvatar(persona, "assistant", avatarShape);
  const regenerateTargetMessageId = findLatestRegenerateTargetMessageId(messages);
  const displayedMessages = messages.filter((item) => !(
    item.role === "assistant" && !String(item.content || "").trim() && !(item.process || []).length
  ));

  function openChatBackground(event) {
    event.preventDefault();
    event.stopPropagation();
    setHeaderMenuOpen(false);
    onOpenChatBackground?.();
  }

  function enterDeleteMode(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (isSending || !displayedMessages.some((message) => message.id !== "opening")) return;
    setHeaderMenuOpen(false);
    setProcessMessage(null);
    setDeleteFromMessageId("");
    setDeleteMode(true);
  }

  function cancelDeleteMode() {
    if (deletingMessages) return;
    setDeleteMode(false);
    setDeleteFromMessageId("");
    setDeleteConfirmationOpen(false);
  }

  async function confirmDeleteMessages() {
    if (!deleteFromMessageId || deletingMessages) return;
    setDeletingMessages(true);
    const deleted = await onDeleteMessages?.(deleteFromMessageId);
    if (deleted !== false) {
      setGenerationStats(null);
      if (conversationId) {
        getGenerationStats(conversationId)
          .then((stats) => setGenerationStats(stats))
          .catch(() => {});
      }
      setDeleteMode(false);
      setDeleteFromMessageId("");
      setDeleteConfirmationOpen(false);
    }
    setDeletingMessages(false);
  }

  function regenerateFrom(message) {
    setGenerationStats(null);
    return onRegenerate?.(message);
  }

  const deleteFromIndex = displayedMessages.findIndex((message) => message.id === deleteFromMessageId);
  const selectedDeleteCount = deleteFromIndex < 0 ? 0 : displayedMessages.length - deleteFromIndex;

  function receiveImages(files) {
    try {
      Promise.resolve(onAddImages?.(files)).catch((error) => onNotify?.("error", error?.message || "图片添加失败"));
    } catch (error) {
      onNotify?.("error", error?.message || "图片添加失败");
    }
  }

  function receiveFiles(files) {
    try {
      Promise.resolve(onAddFiles?.(files)).catch((error) => onNotify?.("error", error?.message || "文件添加失败"));
    } catch (error) {
      onNotify?.("error", error?.message || "文件添加失败");
    }
  }

  function hasFileDrag(event) {
    return [...(event.dataTransfer?.types || [])].includes("Files");
  }

  return (
    <section
      className={`chat-panel layout-${layoutMode}${profile?.assistant_bubble_enabled ? " assistant-bubble-enabled" : ""}${deleteMode ? " message-delete-mode" : ""}`}
      style={displayStyle}
    >
      <header className="chat-header">
        <h1>{currentTitle}</h1>
        <div className="chat-header-actions" ref={headerMenuRef}>
          <button className="chat-header-action" type="button" aria-label="查看轨迹" title="查看轨迹" onClick={() => {
            setHeaderMenuOpen(false);
            setTrajectoryOpen(true);
          }}>
            <Path size={20} weight="bold" />
          </button>
          <button className="chat-header-action" type="button" aria-label="对话操作" title="对话操作" aria-haspopup="menu" aria-expanded={headerMenuOpen} onClick={() => setHeaderMenuOpen((value) => !value)}>
            <SlidersHorizontal size={20} weight="bold" />
          </button>
          <button className="chat-header-action chat-header-new" type="button" aria-label="新建对话" title="新建对话" onClick={onCreateChat}>
            <DshNewChatIcon size={20} />
          </button>
          {headerMenuOpen ? (
            <div
              className="chat-header-menu"
              role="menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={openChatBackground}
              >
                自定义背景
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div
        className={`message-area layout-${layoutMode} ${messageAreaHovered ? "scrollbar-visible" : ""}`}
        ref={bindMessageScrollElement}
        onPointerEnter={() => setMessageAreaHovered(true)}
        onPointerLeave={() => setMessageAreaHovered(false)}
        onScroll={(event) => {
          const previousScrollTop = previousMessageScrollTopRef.current;
          const scrollTop = event.currentTarget.scrollTop;
          previousMessageScrollTopRef.current = scrollTop;
          const movedUp = previousScrollTop !== null && scrollTop < previousScrollTop;
          if (movedUp && scrollTop <= 240 && hasOlderMessages && !isLoadingOlderMessages) {
            onLoadOlderMessages?.();
          }
        }}
        aria-busy={isLoadingOlderMessages || undefined}
      >
        <MessageList
          conversationId={conversationId}
          messages={displayedMessages}
          scrollElement={messageScrollElement}
          scrollRequest={scrollRequest}
          layoutMode={layoutMode}
          profile={profile}
          avatarShape={avatarShape}
          userAvatar={userAvatar}
          assistantAvatar={assistantAvatar}
          userName={persona.user_name}
          assistantName={persona.assistant_name}
          showRoleplayTimestamp={chatDisplay?.roleplay_timestamps_enabled !== false}
          showRoleplayFloor={chatDisplay?.roleplay_message_floors_enabled !== false}
          onOpenProcess={setProcessMessage}
          onEditMessage={onEditMessage}
          onEditOpening={onEditOpening}
          onSelectOpening={onSelectOpening}
          onRegenerate={regenerateFrom}
          deleteMode={deleteMode}
          deleteFromMessageId={deleteFromMessageId}
          onSelectDeleteFrom={setDeleteFromMessageId}
          runtimeSessionId={runtimeSessionId}
          renderRoleplaySlot={renderRoleplaySlot}
          renderRoleplayMessage={renderRoleplayMessage}
        />
      </div>

      <div className="chat-composer-region">
        {deleteMode ? (
          <div className="chat-message-delete-bar" aria-label="删除消息">
            <button
              className="delete-confirm"
              type="button"
              disabled={!deleteFromMessageId || deletingMessages}
              onClick={() => setDeleteConfirmationOpen(true)}
            >
              {deletingMessages ? "删除中" : "删除"}
            </button>
            <button type="button" disabled={deletingMessages} onClick={cancelDeleteMode}>取消</button>
          </div>
        ) : (
          <>
            {isSending ? <div className="chat-waiting-slot"><ChatWaitingReply /></div> : null}
            <ChatComposer
          input={input}
          setInput={setInput}
          inputImages={inputImages}
          onAddImages={receiveImages}
          onRemoveImage={onRemoveImage}
          inputFiles={inputFiles}
          onAddFiles={receiveFiles}
          onRemoveFile={onRemoveFile}
          filesUploading={filesUploading}
          fileUploadProgress={fileUploadProgress}
          isSending={isSending}
          modelConfigs={modelConfigs}
          selectedModelConfigId={selectedModelConfigId}
          selectedModel={selectedModel}
          modelOptionsByKey={modelOptionsByKey}
          onLoadModelOptions={onLoadModelOptions}
          onSelectModel={onSelectModel}
          onSaveModelConfig={onSaveModelConfig}
          onNotify={onNotify}
          onSend={onSend}
          onStop={onStop}
          onCreateChat={onCreateChat}
          onOpenHistory={onOpenHistory}
          onOpenTools={() => setToolsOpen(true)}
          onOpenVariables={() => setVariablesOpen(true)}
          onEnterDeleteMode={enterDeleteMode}
          canDeleteMessages={displayedMessages.some((message) => message.id !== "opening")}
          onRegenerate={regenerateFrom}
          regenerateTargetMessageId={regenerateTargetMessageId}
          generationStats={generationStats}
          showGenerationStats={chatDisplay?.generation_stats_enabled !== false}
          renderRoleplaySlot={renderRoleplaySlot}
          conversationId={conversationId}
            />
          </>
        )}
        {renderRoleplaySlot?.("eleckoi.roleplay.composer.dock", { conversationId })}
      </div>
      {imageDragActive ? <ChatDropOverlay disabled={isSending} /> : null}
      {processMessage ? (
        <AgentProcessDialog
          message={messages.find((item) => (
            item.id === processMessage.id
            || item.renderKey === (processMessage.renderKey || processMessage.id)
          )) || processMessage}
          reasoningDisplayMode={chatDisplay?.reasoning_display_mode || "collapsed"}
          onClose={() => setProcessMessage(null)}
        />
      ) : null}
      {trajectoryOpen ? <TrajectoryDialog
        conversationId={conversationId}
        isSending={isSending}
        onClose={() => setTrajectoryOpen(false)}
      /> : null}
      {variablesOpen ? <VariableViewerDialog conversationId={conversationId} conversationModel={conversationModel} onClose={() => setVariablesOpen(false)} onNotify={onNotify} /> : null}
      {toolsOpen ? <AgentToolsDialog
        modelConfigs={modelConfigs}
        modelOptionsByKey={modelOptionsByKey}
        onLoadModels={onLoadModelOptions}
        onSaveModelConfig={onSaveModelConfig}
        onClose={() => setToolsOpen(false)}
        onManage={onOpenPresetTools}
        onNotify={onNotify}
      /> : null}
      <ConfirmationDialog
        open={deleteConfirmationOpen}
        title="删除这些消息？"
        description={`将删除选中消息及其后的全部内容，共 ${selectedDeleteCount} 条。相关变量、设定状态、工具调用和媒体记录也会一起回退或清理。`}
        confirmLabel="删除消息"
        destructive
        busy={deletingMessages}
        onCancel={() => setDeleteConfirmationOpen(false)}
        onConfirm={confirmDeleteMessages}
      />
    </section>
  );
}

function MessageList({
  conversationId,
  messages,
  scrollElement,
  scrollRequest,
  layoutMode,
  profile,
  avatarShape,
  userAvatar,
  assistantAvatar,
  userName,
  assistantName,
  showRoleplayTimestamp,
  showRoleplayFloor,
  onOpenProcess,
  onEditMessage,
  onEditOpening,
  onSelectOpening,
  onRegenerate,
  deleteMode,
  deleteFromMessageId,
  onSelectDeleteFrom,
  runtimeSessionId,
  renderRoleplaySlot,
  renderRoleplayMessage,
}) {
  const latestAssistantIndex = messages.findLastIndex((message) => message.role === "assistant" && !message.pending);
  const followingRef = useRef(true);
  const restoredConversationRef = useRef("");
  const scrollRevisionRef = useRef(scrollRequest.revision);
  const readerGestureRef = useRef(false);
  const deleteFromIndex = deleteMode
    ? messages.findIndex((message) => message.id === deleteFromMessageId)
    : -1;

  useLayoutEffect(() => {
    if (!scrollElement || !conversationId || messages.length === 0
      || restoredConversationRef.current === conversationId) return;
    restoredConversationRef.current = conversationId;
    scrollRevisionRef.current = scrollRequest.revision;
    followingRef.current = true;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [conversationId, messages.length, scrollElement, scrollRequest.revision]);

  useLayoutEffect(() => {
    if (!scrollElement || scrollRevisionRef.current === scrollRequest.revision) return;
    scrollRevisionRef.current = scrollRequest.revision;
    followingRef.current = true;
    scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: scrollRequest.behavior || "auto" });
  }, [scrollElement, scrollRequest.behavior, scrollRequest.revision]);

  useLayoutEffect(() => {
    if (!scrollElement) return undefined;
    const flow = scrollElement.querySelector('.message-flow');
    if (!flow) return undefined;
    const follow = () => {
      if (followingRef.current) scrollElement.scrollTop = scrollElement.scrollHeight;
    };
    const observe = typeof ResizeObserver === 'function' ? new ResizeObserver(follow) : null;
    observe?.observe(flow);
    const onScroll = () => {
      const gap = scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
      if (gap <= 32) followingRef.current = true;
      else if (readerGestureRef.current) followingRef.current = false;
    };
    const onWheel = (event) => { if (event.deltaY < 0) followingRef.current = false; };
    const onPointerDown = () => { readerGestureRef.current = true; };
    const onPointerUp = () => { readerGestureRef.current = false; };
    const onKeyDown = (event) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followingRef.current = false;
    };
    scrollElement.addEventListener('scroll', onScroll, { passive: true });
    scrollElement.addEventListener('wheel', onWheel, { passive: true });
    scrollElement.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    scrollElement.addEventListener('keydown', onKeyDown);
    follow();
    return () => {
      observe?.disconnect();
      scrollElement.removeEventListener('scroll', onScroll);
      scrollElement.removeEventListener('wheel', onWheel);
      scrollElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      scrollElement.removeEventListener('keydown', onKeyDown);
    };
  }, [scrollElement]);

  return (
    <div className="message-flow">
      {messages.map((item, index) => {
        const pluginMessage = !deleteMode && renderRoleplaySlot
          && item.runtimeSessionId === runtimeSessionId && !item.pending;
        const pluginActions = pluginMessage && item.role === "assistant" && item.dshMessageId
          ? renderRoleplaySlot("eleckoi.roleplay.message.actions", {
            conversationId: item.conversationId, productMessageId: item.id, messageId: item.dshMessageId,
          }) : null;
        const pluginAfter = pluginMessage
          ? renderRoleplaySlot("eleckoi.roleplay.message.after", {
            conversationId: item.conversationId, productMessageId: item.id,
            messageId: item.dshMessageId || null, role: item.role,
          }) : null;
        const renderMessageContent = pluginMessage ? renderRoleplayMessage : undefined;
        const selectedForDelete = deleteFromIndex >= 0 && index >= deleteFromIndex;
        const nextRole = messages[index + 1]?.role;
        const spacingAfter = nextRole
          ? layoutMode === "agent" && item.role === "user" && nextRole === "assistant"
            ? profile.reply_spacing
            : profile.turn_spacing
          : 0;
        return (
          <div
            key={item.renderKey || item.id || `${item.role || "message"}-${item.created_at || index}`}
            className="message-flow-row"
            data-index={index}
            style={{ paddingBottom: `${spacingAfter}px` }}
          >
            {deleteMode ? (
              <div className={`message-delete-selection-row layout-${layoutMode}${selectedForDelete ? " is-selected" : ""}`}>
                <input
                  className="message-delete-checkbox"
                  type="checkbox"
                  checked={selectedForDelete}
                  disabled={item.id === "opening"}
                  aria-label={`从这条消息开始删除${selectedForDelete ? "，已选中" : ""}`}
                  onChange={() => onSelectDeleteFrom(item.id)}
                />
                <MessageBubble
                  message={item}
                  avatar={item.role === "user" ? userAvatar : assistantAvatar}
                  name={item.role === "user" ? userName : assistantName}
                  layoutMode={layoutMode}
                  avatarShape={avatarShape}
                  isLatestAssistant={index === latestAssistantIndex}
                  floorNumber={messageFloorNumber(messages, index)}
                  showRoleplayTimestamp={showRoleplayTimestamp}
                  showRoleplayFloor={showRoleplayFloor}
                  onOpenProcess={onOpenProcess}
                  onSelectOpening={onSelectOpening}
                  pluginActions={pluginActions}
                  pluginAfter={pluginAfter}
                  renderMessageContent={renderMessageContent}
                />
              </div>
            ) : (
              <MessageBubble
                message={item}
                avatar={item.role === "user" ? userAvatar : assistantAvatar}
                name={item.role === "user" ? userName : assistantName}
                layoutMode={layoutMode}
                avatarShape={avatarShape}
                isLatestAssistant={index === latestAssistantIndex}
                floorNumber={messageFloorNumber(messages, index)}
                showRoleplayTimestamp={showRoleplayTimestamp}
                showRoleplayFloor={showRoleplayFloor}
                onOpenProcess={onOpenProcess}
                onEdit={item.id === "opening" ? onEditOpening : onEditMessage}
                onSelectOpening={onSelectOpening}
                onRegenerate={(message) => onRegenerate?.({ targetMessageId: message.turnId || message.id })}
                pluginActions={pluginActions}
                pluginAfter={pluginAfter}
                renderMessageContent={renderMessageContent}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
