import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  cancelChatStream,
  createChat as createChatSession,
  deleteChat,
  deleteChatMessagesFrom,
  getChat,
  listenAgentProcess,
  listenChatStreamDelta,
  listChats,
  mapChatDetails,
  mapConversations,
  regenerateChatMessage,
  selectChatOpening,
  updateChatOpening,
} from "../api/chatApi.js";
import { useChatInputFiles } from './useChatInputFiles.js';
import {
  createEmptyChatCharacter,
  normalizeChatItemCharacter,
  normalizeChatCharacter,
  withLatestCharacter,
} from "../model/chatCharacter.js";
import {
  applyLatestCharactersToSessions,
  collapseSessionsByCharacter,
  createCharacterLookup,
  currentChatTitle,
  filterHiddenConversationEntries,
  filterConversationSessions,
  selectSessionForCharacter,
  sortSessionsByPinned,
} from "../model/chatSessionView.js";
import { findRegenerateBranchUserIndex } from "../model/chatRegeneration.js";
import { useConversationListPreferences } from "./useConversationListPreferences.js";
import { useActiveChatModel } from "./useActiveChatModel.js";
import { mergeProcessItems, useConversationMessages } from "./useConversationMessages.js";
import { useChatHistoryPaging } from "./useChatHistoryPaging.js";
import { useAuthorFrontendActions } from "./useAuthorFrontendActions.js";
import { useChatInputImages } from "./useChatInputImages.js";
import { getErrorMessage, isAbortError, runChatMessageSend, stopChatMessageSend, throwIfAborted, upsertProcess } from "./chatMessageSend.js";
import { readSetting, writeSetting } from "../../../bridge/settingsClient.js";

const EMPTY_CATALOG = { status: "loading", items: [], error: "" };
const EMPTY_DETAILS = { id: "", status: "idle", details: null, error: "" };
const EMPTY_STREAM = { id: "", status: "idle", content: "", process: [] };
const subscribeEmptyCatalog = () => () => {};
const getEmptyCatalog = () => EMPTY_CATALOG;
const getEmptyDetails = () => EMPTY_DETAILS;
const getEmptyStream = () => EMPTY_STREAM;
let selectionWriteQueue = Promise.resolve();

function saveChatSelection(selection) {
  const operation = selectionWriteQueue.then(() => writeSetting("chat.selection", selection));
  selectionWriteQueue = operation.catch(() => {});
  return operation;
}

export function useChatSessions({ conversations, persona, characters, modelConfigs, language, setStatus, setActiveSectionState, notify }) {
  const [localSessions, setLocalSessions] = useState([]);
  const catalog = useSyncExternalStore(
    conversations?.subscribe || subscribeEmptyCatalog,
    conversations?.getSnapshot || getEmptyCatalog,
  );
  const detailsSnapshot = useSyncExternalStore(
    conversations?.subscribeDetails || subscribeEmptyCatalog,
    conversations?.getDetailsSnapshot || getEmptyDetails,
  );
  const streamSnapshot = useSyncExternalStore(
    conversations?.subscribeStream || subscribeEmptyCatalog,
    conversations?.getStreamSnapshot || getEmptyStream,
  );
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(() => {
    if (!conversations || catalog.status !== "error" || !catalog.error) return;
    setStatus(catalog.error);
    notifyRef.current?.("error", catalog.error);
  }, [catalog.error, catalog.status, conversations, setStatus]);
  useEffect(() => {
    if (!conversations || detailsSnapshot.status !== "error" || !detailsSnapshot.error) return;
    setStatus(detailsSnapshot.error);
    notifyRef.current?.("error", detailsSnapshot.error);
  }, [conversations, detailsSnapshot.error, detailsSnapshot.status, setStatus]);
  const sessions = useMemo(
    () => conversations ? mapConversations(catalog.items) : localSessions,
    [catalog.items, conversations, localSessions],
  );
  const [sessionId, setSessionId] = useState(() => conversations?.getDetailsSnapshot()?.id || "");
  const preferredSessionByCharacterRef = useRef(new Map());
  const [selectionReady, setSelectionReady] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const loadGenerationRef = useRef(0);
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [isSending, setIsSending] = useState(false);
  const restoredRun = Boolean(conversations && streamSnapshot.id === sessionId
    && streamSnapshot.status === "running" && streamSnapshot.runId && !isSending);
  const chatBusy = isSending || restoredRun;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatCharacter, setChatCharacter] = useState(() => createEmptyChatCharacter());

  const requestRef = useRef(null);
  const {
    pinnedIds,
    hiddenIds,
    togglePinChat: togglePinnedChat,
    unpinChat,
    hideChatEntry,
    restoreChatEntry,
  } = useConversationListPreferences();
  const { modelConfig, modelSelection, selectChatModel } = useActiveChatModel({ modelConfigs, setStatus });
  const {
    inputImages, inputImagesRef, modelSupportsImages, addInputImages, removeInputImage, clearInputImages,
  } = useChatInputImages({ modelConfig, isSending: chatBusy });
  const { inputFiles, inputFilesRef, filesUploading, fileUploadProgress, addInputFiles, removeInputFile, clearInputFiles, discardInputFiles } = useChatInputFiles();
  const {
    messages,
    displayedMessages,
    setMessages,
    setMessagesWithScroll,
    reconcileMessages,
    updatePendingReply,
    settlePendingReply,
    commitPendingError,
    prependMessages,
    historyPage,
    requestScrollToEnd,
    scrollRequest,
    scrollRef,
  } = useConversationMessages();
  const visibleMessages = useMemo(() => {
    if (!restoredRun || !streamSnapshot.messageId) return displayedMessages;
    const index = displayedMessages.findIndex((message) => message.id === streamSnapshot.messageId);
    if (index < 0) return [...displayedMessages, {
      id: streamSnapshot.messageId,
      conversationId: sessionId,
      role: "assistant",
      content: streamSnapshot.content,
      variableStateJson: '{}',
      status: "streaming",
      pending: true,
      process: streamSnapshot.process,
      created_at: "",
    }];
    return displayedMessages.map((message, messageIndex) => messageIndex === index ? {
      ...message,
      content: streamSnapshot.content,
      status: "streaming",
      pending: true,
      process: mergeProcessItems(message.process, streamSnapshot.process),
    } : message);
  }, [displayedMessages, restoredRun, sessionId, streamSnapshot]);
  const { isLoadingOlderMessages, loadOlderMessages } = useChatHistoryPaging({
    sessionId,
    historyPage,
    prependMessages,
    setStatus,
    conversations,
  });

  const characterLookup = useMemo(() => createCharacterLookup(characters), [characters]);
  const displaySessions = useMemo(() => applyLatestCharactersToSessions(sessions, characterLookup), [characterLookup, sessions]);
  const sortedSessions = useMemo(() => sortSessionsByPinned(displaySessions, pinnedIds), [displaySessions, pinnedIds]);
  const conversationSessions = useMemo(() => collapseSessionsByCharacter(
    sortedSessions,
    sessionId,
    conversations?.preferredSessions || preferredSessionByCharacterRef.current,
  ), [conversations, sessionId, sortedSessions]);
  const visibleConversationSessions = useMemo(
    () => filterHiddenConversationEntries(conversationSessions, hiddenIds),
    [conversationSessions, hiddenIds],
  );
  const filteredSessions = useMemo(
    () => filterConversationSessions(visibleConversationSessions, keyword),
    [keyword, visibleConversationSessions],
  );
  const currentTitle = useMemo(
    () => currentChatTitle(displaySessions, sessionId, chatCharacter),
    [chatCharacter.assistant_name, chatCharacter.character_name, displaySessions, sessionId],
  );

  useEffect(() => {
    if (!conversations || !selectionReady) return;
    void saveChatSelection({
      active_conversation_id: sessionId,
      preferred_sessions: Object.fromEntries(preferredSessionByCharacterRef.current),
    }).catch((error) => {
      notifyRef.current?.("error", getErrorMessage(error, "保存当前聊天记录失败"));
    });
  }, [conversations, selectionReady, selectionRevision, sessionId]);

  function rememberPreferredSession(characterId, id) {
    if (!characterId || !id) return;
    if (preferredSessionByCharacterRef.current.get(characterId) !== id) {
      preferredSessionByCharacterRef.current.set(characterId, id);
      setSelectionRevision((value) => value + 1);
    }
    conversations?.rememberSession?.(characterId, id);
  }

  function forgetPreferredSession(characterId, id) {
    if (!characterId || preferredSessionByCharacterRef.current.get(characterId) !== id) return;
    preferredSessionByCharacterRef.current.delete(characterId);
    conversations?.forgetSession?.(characterId, id);
    setSelectionRevision((value) => value + 1);
  }

  function normalizeLatestChatCharacter(chat) {
    return normalizeChatItemCharacter(withLatestCharacter(chat || {}, characterLookup));
  }

  function replaceChatMessages(chat, behavior = null) {
    if (conversations && chat?.id && conversations.getDetailsSnapshot().id !== chat.id) {
      conversations.activate(chat.id);
      void conversations.refreshDetails().catch(() => {});
    }
    setMessagesWithScroll(chat?.messages || [], behavior, {
      hasMore: chat?.messages_has_more,
      beforeSequence: chat?.messages_before_sequence,
    });
  }

  function reconcileChatMessages(chat) {
    reconcileMessages(chat?.messages || [], {
      hasMore: chat?.messages_has_more,
      beforeSequence: chat?.messages_before_sequence,
    });
  }

  useEffect(() => {
    const details = detailsSnapshot.details;
    if (!conversations || !details || details.conversation.id !== sessionId || isSending) return;
    const chat = mapChatDetails(details);
    reconcileChatMessages(chat);
    setChatCharacter(normalizeLatestChatCharacter(chat));
  }, [conversations, detailsSnapshot.details, sessionId]);

  useEffect(() => {
    if (!conversations || !isSending || streamSnapshot.id !== sessionId || streamSnapshot.status !== "running") return;
    updatePendingReply((current) => current ? {
      ...current,
      content: streamSnapshot.content,
      process: streamSnapshot.process,
    } : current);
  }, [conversations, isSending, sessionId, streamSnapshot]);

  async function readSessions() {
    if (conversations) {
      return { items: mapConversations(await conversations.refresh()) };
    }
    return listChats();
  }

  async function loadSessions(preferredId = "") {
    const restoreGeneration = loadGenerationRef.current;
    let savedSelection = null;
    if (conversations) {
      try {
        savedSelection = await readSetting("chat.selection");
        if (restoreGeneration === loadGenerationRef.current) {
          for (const [characterId, id] of Object.entries(savedSelection?.preferred_sessions || {})) {
            if (characterId && id) rememberPreferredSession(characterId, id);
          }
        }
      } catch (error) {
        notifyRef.current?.("error", getErrorMessage(error, "读取当前聊天记录失败"));
      }
    }
    const data = await readSessions();
    const items = data.items || [];
    if (!conversations) setLocalSessions(items);
    try {
      if (restoreGeneration !== loadGenerationRef.current) return;
      const availableIds = new Set(items.map((item) => item.id));
      const targetId = [preferredId, savedSelection?.active_conversation_id, sessionId,
        conversations?.getDetailsSnapshot()?.id, items[0]?.id]
        .find((id) => id && availableIds.has(id)) || "";
      if (targetId) await loadChat(targetId);
      else {
        setSessionId("");
        setMessagesWithScroll([], "auto");
      }
    } catch (error) {
      setSessionId("");
      setMessagesWithScroll([], "auto");
      notifyRef.current?.("error", getErrorMessage(error, "恢复当前聊天记录失败"));
    } finally {
      if (conversations) setSelectionReady(true);
    }
  }

  async function refreshSessionsOnly(options = {}) {
    const data = await readSessions();
    if (!conversations) setLocalSessions(data.items || []);
    if (!options.keepSection) setActiveSectionState("messages");
  }

  async function openHistory() {
    const data = await readSessions();
    if (!conversations) setLocalSessions(data.items || []);
    setHistoryOpen(true);
  }

  function closeHistory() {
    setHistoryOpen(false);
  }

  async function loadChat(sessionIdToLoad, options = {}) {
    if (chatBusy) {
      setStatus("正在生成，请先停止或等待完成");
      return;
    }
    clearInputImages();
    discardInputFiles();
    const loadGeneration = ++loadGenerationRef.current;
    const shouldBumpToTop = Boolean(options.bumpToTop);
    const data = await getChat(sessionIdToLoad, { model: conversations });
    if (!data || loadGeneration !== loadGenerationRef.current) return;
    if (data.chat.character_id) {
      rememberPreferredSession(data.chat.character_id, data.chat.id);
    }
    setSessionId(data.chat.id);
    replaceChatMessages(data.chat, "auto");
    setChatCharacter(normalizeLatestChatCharacter(data.chat));
    setActiveSectionState("messages");
    if (shouldBumpToTop) {
      await refreshSessionsOnly({ keepSection: true });
    }
  }

  async function openCharacterChat(role) {
    if (chatBusy) {
      setStatus("正在生成，请先停止或等待完成");
      return;
    }
    const characterData = normalizeChatCharacter(role);
    const characterId = characterData.character_id;
    const characterName = characterData.assistant_name || characterData.character_name || "未命名角色";
    if (!characterId) return;
    const selectionGeneration = ++loadGenerationRef.current;
    clearInputImages();
    discardInputFiles();
    setChatCharacter(characterData);
    const data = await readSessions();
    if (selectionGeneration !== loadGenerationRef.current) return;
    const items = data.items || [];
    if (!conversations) setLocalSessions(items);
    const preferredId = conversations?.preferredSession?.(characterId)
      || preferredSessionByCharacterRef.current.get(characterId)
      || (chatCharacter.character_id === characterId ? sessionId : "");
    const existing = selectSessionForCharacter(items, characterId, preferredId);
    if (existing?.id) {
      restoreChatEntry(existing.id);
      await loadChat(existing.id, { bumpToTop: true });
      return;
    }
    const created = await createChatSession(characterName, characterData);
    if (selectionGeneration !== loadGenerationRef.current) return;
    rememberPreferredSession(characterId, created.chat.id);
    setSessionId(created.chat.id);
    replaceChatMessages(created.chat, "auto");
    setChatCharacter(normalizeLatestChatCharacter(created.chat));
    await refreshSessionsOnly();
    setActiveSectionState("messages");
  }

  function abortActiveRequest() {
    const activeRequest = requestRef.current;
    requestRef.current = null;
    activeRequest?.controller?.abort?.();
    activeRequest?.unlisten?.();
    if (activeRequest?.requestId) {
      (conversations
        ? conversations.cancelRequest(activeRequest.conversationId || sessionId, activeRequest.requestId)
        : cancelChatStream(activeRequest.requestId)).catch(() => {});
    }
  }

  async function createChat() {
    if (chatBusy) {
      setStatus("正在生成，请先停止或等待完成");
      return;
    }
    if (!chatCharacter.character_id) {
      setStatus("请先从角色设定中双击角色进入聊天");
      return;
    }
    abortActiveRequest();
    clearInputImages();
    discardInputFiles();
    const characterName = chatCharacter.assistant_name || chatCharacter.character_name || "新对话";
    try {
      const created = await createChatSession(characterName, chatCharacter);
      const chat = created.chat;
      rememberPreferredSession(chatCharacter.character_id, chat.id);
      setSessionId(chat.id);
      replaceChatMessages(chat, "auto");
      setInput("");
      setIsSending(false);
      setChatCharacter(normalizeLatestChatCharacter(chat));
      await refreshSessionsOnly();
      setStatus("新会话");
      setActiveSectionState("messages");
    } catch (error) {
      setStatus(getErrorMessage(error, "新建会话失败"));
    }
  }

  async function selectOpening(message, openingId) {
    if (!sessionId || chatBusy || message?.id !== "opening" || !openingId) return;
    try {
      const result = await selectChatOpening(sessionId, openingId);
      replaceChatMessages(result.chat, "auto");
      conversations?.invalidateDetails(sessionId);
      setChatCharacter(normalizeLatestChatCharacter(result.chat));
      await refreshSessionsOnly({ keepSection: true });
    } catch (error) {
      setStatus(getErrorMessage(error, "切换开场白失败"));
    }
  }

  async function editOpening(message, replacementMessage) {
    if (!sessionId || chatBusy || message?.id !== "opening") return;
    try {
      const result = await updateChatOpening(sessionId, replacementMessage);
      replaceChatMessages(result.chat, "auto");
      conversations?.invalidateDetails(sessionId);
      setChatCharacter(normalizeLatestChatCharacter(result.chat));
      await refreshSessionsOnly({ keepSection: true });
    } catch (error) {
      setStatus(getErrorMessage(error, "修改开场白失败"));
    }
  }

  function clearActiveChat() {
    loadGenerationRef.current += 1;
    abortActiveRequest();
    clearInputImages();
    discardInputFiles();
    conversations?.activate("");
    setSessionId("");
    setMessagesWithScroll([], "auto");
    setInput("");
    setChatCharacter(createEmptyChatCharacter());
    setIsSending(false);
    setStatus("就绪");
  }

  function togglePinChat(chatId) {
    togglePinnedChat(chatId);
  }

  async function removeHistoryChat(chatId) {
    if (!chatId) return;
    const target = displaySessions.find((item) => item.id === chatId) || sessions.find((item) => item.id === chatId);
    const targetCharacterId = target?.character_id || "";
    const sameCharacterSessions = targetCharacterId ? displaySessions.filter((item) => item.character_id === targetCharacterId) : [];
    const remainingSameCharacterSessions = sameCharacterSessions
      .filter((item) => item.id !== chatId)
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    const shouldCreateReplacement = Boolean(targetCharacterId) && remainingSameCharacterSessions.length === 0;

    await deleteChat(chatId);
    unpinChat(chatId);
    forgetPreferredSession(targetCharacterId, chatId);

    if (shouldCreateReplacement) {
      const latestCharacter = characterLookup.get(targetCharacterId);
      const replacementCharacter = latestCharacter || normalizeChatCharacter({
        character_id: targetCharacterId,
        character_name: target?.character_name || chatCharacter.character_name || chatCharacter.assistant_name || "新对话",
        character_avatar: target?.character_avatar || chatCharacter.character_avatar || chatCharacter.assistant_avatar || "",
        assistant_name: target?.character_name || chatCharacter.assistant_name || chatCharacter.character_name || "新对话",
        assistant_avatar: target?.character_avatar || chatCharacter.assistant_avatar || chatCharacter.character_avatar || "",
      });
      const characterName = replacementCharacter.assistant_name || replacementCharacter.character_name || "新对话";
      const created = await createChatSession(characterName, replacementCharacter);
      rememberPreferredSession(targetCharacterId, created.chat.id);
      setSessionId(created.chat.id);
      replaceChatMessages(created.chat, "auto");
      setInput("");
      setChatCharacter(normalizeLatestChatCharacter(created.chat));
      setActiveSectionState("messages");
      await refreshSessionsOnly({ keepSection: true });
      return;
    }

    if (chatId === sessionId) {
      const nextSession = remainingSameCharacterSessions[0];
      if (nextSession?.id) {
        await loadChat(nextSession.id);
        await refreshSessionsOnly({ keepSection: true });
        return;
      }
      clearActiveChat();
    }
    await refreshSessionsOnly({ keepSection: true });
  }

  async function openChatWindow(chatId) {
    if (!chatId) return;

    const label = `chat-${String(chatId).replace(/[^a-zA-Z0-9-/:_]/g, "_")}`;
    const url = new URL(window.location.href);
    url.search = `?view=chat&chat=${encodeURIComponent(chatId)}`;
    window.open(url.toString(), label, "width=960,height=720");
    clearActiveChat();
  }

  function stopSend() {
    if (restoredRun) {
      void conversations.cancelStream(streamSnapshot.runId).then((cancelled) => {
        if (!cancelled) setStatus("这次回复已结束");
      }).catch((error) => {
        const message = getErrorMessage(error, "停止生成失败");
        setStatus(message);
        notify?.("error", message);
      });
      return;
    }
    const activeRequest = requestRef.current;
    stopChatMessageSend({
      requestRef, setIsSending, setStatus, settlePendingReply, notify,
      cancelRequest: conversations
        ? (requestId) => conversations.cancelRequest(activeRequest?.conversationId || sessionId, requestId)
        : cancelChatStream,
    });
  }

  function sendMessage(event, inputOverride) {
    return runChatMessageSend({
      event, input: inputOverride ?? input, inputImagesRef, inputFilesRef, isSending: chatBusy || filesUploading, modelConfig, modelSupportsImages, setStatus,
      requestRef, setIsSending, sessionId, chatCharacter, setSessionId, replaceChatMessages,
      setChatCharacter, normalizeLatestChatCharacter, refreshSessionsOnly, setInput, clearInputImages, clearInputFiles,
      setMessages, updatePendingReply, requestScrollToEnd,
      reconcileChatMessages, commitPendingError, notify, restoreChatEntry, conversationModel: conversations,
    });
  }

  async function deleteMessagesFrom(messageId) {
    if (!sessionId || !messageId || chatBusy) return false;
    try {
      const result = await deleteChatMessagesFrom(sessionId, messageId);
      replaceChatMessages(result.chat, "auto");
      conversations?.invalidateDetails(sessionId);
      setChatCharacter(normalizeLatestChatCharacter(result.chat));
      await refreshSessionsOnly({ keepSection: true });
      setStatus(`已删除 ${result.deletedMessageCount} 条消息`);
      return true;
    } catch (error) {
      setStatus(getErrorMessage(error, "删除消息失败"));
      return false;
    }
  }

  async function regenerateReply(options = {}) {
    if (!sessionId || chatBusy) return;
    if (!modelConfig?.id || !modelConfig.model?.trim()) {
      setStatus("请先在发送按钮左侧选择模型");
      return;
    }
    const requestedTargetMessageId = String(options.targetMessageId || "").trim();
    const hasReplacementMessage = Object.prototype.hasOwnProperty.call(options, "replacementMessage");
    const replacementMessage = hasReplacementMessage ? String(options.replacementMessage || "").trim() : "";
    if (!requestedTargetMessageId) {
      setStatus(hasReplacementMessage ? "请选择要修改的输入" : "请选择要重新生成的 AI 回复");
      return;
    }
    if (hasReplacementMessage && !replacementMessage) {
      setStatus("输入不能为空");
      return;
    }

    const branchUserIndex = findRegenerateBranchUserIndex(messages, requestedTargetMessageId, hasReplacementMessage);
    if (branchUserIndex < 0) {
      setStatus(hasReplacementMessage ? "没有找到要修改的用户输入" : "没有找到这条回复对应的用户输入");
      return;
    }
    const branchUser = messages[branchUserIndex];
    const targetMessageId = String(branchUser?.turnId || branchUser?.id || requestedTargetMessageId).trim();
    restoreChatEntry(sessionId);

    const controller = new AbortController();
    const activeRequest = { controller };
    activeRequest.conversationId = sessionId;
    requestRef.current = activeRequest;
    setIsSending(true);
    setStatus("正在重新生成...");
    let assistantId = "";

    try {
      const createdAt = new Date().toISOString();
      assistantId = `regen-${Date.now()}`;
      const payload = {
        target_message_id: targetMessageId,
        replacement_message: hasReplacementMessage ? replacementMessage : null,
      };
      setMessages((items) => {
        const userIndex = findRegenerateBranchUserIndex(items, targetMessageId, hasReplacementMessage);
        if (userIndex < 0) return items;
        const branch = items.slice(0, userIndex + 1).map((item, index) =>
          index === userIndex && hasReplacementMessage ? { ...item, content: replacementMessage } : item,
        );
        return branch;
      });
      updatePendingReply({ id: assistantId, conversationId: sessionId, role: "assistant", content: "", variableStateJson: '{}', pending: true, created_at: createdAt });
      requestScrollToEnd("auto");

      let result;
      const requestId = `regen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeRequest.requestId = requestId;
      if (!conversations) {
        const unlistenProcess = await listenAgentProcess((event) => {
          if (event?.request_id !== requestId || event?.session_id !== sessionId || !event?.item) return;
          updatePendingReply((current) => current?.id === assistantId
            ? { ...current, process: upsertProcess(current.process, event.item) }
            : current);
        });
        activeRequest.unlisten = unlistenProcess;
        throwIfAborted(controller.signal);
        const unlistenDelta = await listenChatStreamDelta((event) => {
          if (event?.request_id !== requestId || event?.session_id !== sessionId || !event?.delta) return;
          updatePendingReply((current) => current?.id === assistantId
            ? { ...current, pending: true, content: `${current.content || ""}${event.delta}` }
            : current);
        });
        activeRequest.unlisten = () => { unlistenDelta(); unlistenProcess(); };
      }
      throwIfAborted(controller.signal);
      result = await regenerateChatMessage(sessionId, payload, requestId, { model: conversations });
      if (result.cancelled) {
        if (requestRef.current === null || requestRef.current === activeRequest) {
          replaceChatMessages(result.chat);
          conversations?.invalidateDetails(sessionId);
        }
        if (requestRef.current === activeRequest) setStatus("已停止");
        return;
      }
      if (requestRef.current !== activeRequest) return;
      replaceChatMessages(result.chat);
      conversations?.invalidateDetails(sessionId);
      setChatCharacter(normalizeLatestChatCharacter(result.chat || {}));
      await refreshSessionsOnly();
      if (requestRef.current !== activeRequest) return;
      setStatus("回复完成");
    } catch (error) {
      if (requestRef.current === activeRequest && !isAbortError(error)) {
        const message = getErrorMessage(error, "重新生成失败");
        let reconciled = false;
        try {
          const durable = conversations
            ? await getChat(sessionId, { model: conversations })
            : await getChat(sessionId);
          if (requestRef.current === activeRequest) {
            replaceChatMessages(durable.chat);
            conversations?.invalidateDetails(sessionId);
            setChatCharacter(normalizeLatestChatCharacter(durable.chat || {}));
            reconciled = true;
          }
        } catch {
          // Preserve the original regeneration failure when durable refresh also fails.
        }
        if (requestRef.current !== activeRequest) return;
        if (!reconciled) commitPendingError(assistantId);
        setStatus(message);
        notify?.("error", message);
      }
    } finally {
      activeRequest.unlisten?.();
      if (requestRef.current === activeRequest) {
        requestRef.current = null;
        setIsSending(false);
      }
    }
  }

  useEffect(() => {
    if (!chatCharacter.character_id) return;
    const latest = characterLookup.get(chatCharacter.character_id);
    if (!latest) return;
    setChatCharacter((current) => {
      if (current.character_id !== latest.character_id) return current;
      const next = {
        ...current,
        character_name: latest.character_name,
        character_avatar: latest.character_avatar,
        assistant_name: latest.assistant_name,
        assistant_avatar: latest.assistant_avatar,
        assistant_square: latest.assistant_square,
        assistant_cover: latest.assistant_cover,
        opening: latest.opening,
        show_opening: latest.show_opening,
        chat_background: latest.chat_background,
        chat_background_opacity: latest.chat_background_opacity,
        chat_background_blur: latest.chat_background_blur,
        chat_background_scrim: latest.chat_background_scrim,
      };
      return Object.keys(next).some((key) => next[key] !== current[key]) ? next : current;
    });
  }, [chatCharacter.character_id, characterLookup]);

  useAuthorFrontendActions({ sessionId, setIsSending, setStatus, setMessages, reconcileChatMessages,
    replaceChatMessages, conversations,
    setChatCharacter, normalizeLatestChatCharacter, refreshSessionsOnly, requestScrollToEnd, loadChat,
    input, inputImages, setInput, sendMessage });

  return {
    sessions: displaySessions,
    sessionId,
    runtimeSessionId: detailsSnapshot.id === sessionId
      ? detailsSnapshot.details?.runtimeSessionId || detailsSnapshot.runtimeSessionId || '' : '',
    messages: visibleMessages,
    input,
    setInput,
    inputImages,
    inputFiles,
    filesUploading,
    fileUploadProgress,
    addInputImages,
    addInputFiles,
    removeInputImage,
    removeInputFile,
    keyword,
    setKeyword,
    isSending: chatBusy,
    filteredSessions,
    historyOpen,
    pinnedIds,
    currentTitle,
    chatCharacter,
    modelSelection,
    selectChatModel,
    scrollRef,
    scrollRequest,
    hasOlderMessages: historyPage.hasMore,
    isLoadingOlderMessages,
    loadOlderMessages,
    loadSessions,
    refreshSessionsOnly,
    openHistory,
    closeHistory,
    loadChat,
    openCharacterChat,
    createChat,
    selectOpening,
    editOpening,
    clearActiveChat,
    sendMessage,
    stopSend,
    regenerateReply,
    deleteMessagesFrom,
    togglePinChat,
    hideChatEntry,
    removeHistoryChat,
    openChatWindow,
    abortActiveRequest,
  };
}
