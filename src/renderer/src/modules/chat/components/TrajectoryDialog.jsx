import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TrajectoryView as OfficialTrajectoryView,
  zh,
} from "@eleckoi/dsh-client-trajectory/client";
import { getTrajectory, readChatImage } from "../api/chatApi.js";

const pageSize = 400;
const emptySnapshot = Object.freeze({
  systemPrompts: Object.freeze([]),
  eventNodes: Object.freeze([]),
  eventLocations: new Map(),
  requests: Object.freeze([]),
  callSchemas: new Map(),
  partial: null,
  runningCalls: Object.freeze([]),
});

export function TrajectoryView({
  conversationId,
  isSending,
  refreshRevision = 0,
  renderSlot,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [actualDuration, setActualDuration] = useState(false);
  const [stringWrapping, setStringWrapping] = useState(true);
  const latestRequestRef = useRef(0);
  const loadingOlderRef = useRef(false);

  useEffect(() => {
    latestRequestRef.current += 1;
    loadingOlderRef.current = false;
    setSnapshot(null);
    setError("");
    setLoading(true);
    setLoadingOlder(false);
    setActualDuration(false);
  }, [conversationId, refreshRevision]);

  const loadLatest = useCallback(async () => {
    const request = ++latestRequestRef.current;
    try {
      const next = await getTrajectory(conversationId, { limit: pageSize });
      if (request !== latestRequestRef.current) return;
      setSnapshot((current) => mergeLatest(current, next));
      setError("");
    } catch (loadError) {
      if (request !== latestRequestRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "轨迹读取失败");
    } finally {
      if (request === latestRequestRef.current) setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void loadLatest();
    const timer = isSending ? window.setInterval(loadLatest, 900) : undefined;
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [isSending, loadLatest, refreshRevision]);

  const loadOlder = useCallback(async () => {
    if (!snapshot?.hasMore || snapshot.beforeIndex === null || loadingOlderRef.current) return false;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await getTrajectory(conversationId, {
        beforeIndex: snapshot.beforeIndex,
        limit: pageSize,
      });
      setSnapshot((current) => mergeOlder(current, older));
      setError("");
      return true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "更早的轨迹读取失败");
      return false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, snapshot?.beforeIndex, snapshot?.hasMore]);

  const officialSnapshot = useMemo(
    () => snapshot ? toOfficialSnapshot(snapshot.records) : emptySnapshot,
    [snapshot],
  );
  const sessionSnapshot = useMemo(() => ({
    openState: loading && snapshot === null ? "loading" : "ready",
    loadingOlder,
    hasMore: Boolean(snapshot?.hasMore),
  }), [loading, loadingOlder, snapshot]);
  const useSession = useCallback(
    (selector) => selector(sessionSnapshot),
    [sessionSnapshot],
  );
  const useTrajectory = useCallback(
    (selector) => selector(officialSnapshot),
    [officialSnapshot],
  );
  const useDuration = useCallback(
    (selector) => selector(actualDuration),
    [actualDuration],
  );
  const loadImage = useCallback(
    (attachment) => readChatImage(conversationId, attachment.attachmentId),
    [conversationId],
  );
  const stringWrappingPreference = useMemo(() => ({
    getDefault: () => stringWrapping,
    setDefault: setStringWrapping,
  }), [stringWrapping]);
  const renderTrajectorySlot = useCallback((name, owner) => {
    if (name !== "conversation.trajectory.images" || !renderSlot) return null;
    return renderSlot("eleckoi.roleplay.trajectory.images", owner);
  }, [renderSlot]);

  if (!loading && error && !snapshot) {
    return <TrajectoryState text={error} action="重试" onAction={loadLatest} />;
  }
  if (!loading && snapshot && !snapshot.runtimeThreadId) {
    return <TrajectoryState text="这个对话还没有 DSH 轨迹" />;
  }
  if (!loading && snapshot?.runtimeThreadId && snapshot.records.length === 0) {
    return <TrajectoryState text="当前会话还没有可显示的事件" />;
  }

  return <section className="trajectory-host" aria-label="轨迹">
    <OfficialTrajectoryView
      useSession={useSession}
      useTrajectory={useTrajectory}
      useDuration={useDuration}
      loadOlder={loadOlder}
      loadImage={loadImage}
      setActualDuration={setActualDuration}
      viewRequest={null}
      completeViewRequest={noop}
      renderSlot={renderTrajectorySlot}
      t={translateTrajectory}
      jsonStringWrapping={stringWrappingPreference}
    />
    {error && snapshot ? <p className="trajectory-inline-error" role="status">{error}</p> : null}
  </section>;
}

function toOfficialSnapshot(records) {
  const eventNodes = [];
  const systemPrompts = [];
  const requests = requestViews(records);
  const toolProjection = projectTools(records);
  let hasSystemPrompt = false;

  for (const record of records) {
    if (record.kind === "system") {
      systemPrompts.push({
        seq: record.seq,
        time: timestamp(record.timeMillis),
        turn: positiveInteger(record.turn) || 1,
        step: nonnegativeInteger(record.step) ?? 0,
        text: record.input || record.output || record.preview,
        update: hasSystemPrompt,
      });
      hasSystemPrompt = true;
      continue;
    }
    if (record.kind === "user" || record.kind === "context") {
      eventNodes.push(inputNode(record));
      continue;
    }
    if (record.kind === "assistant") {
      const node = assistantNode(record);
      if (node) eventNodes.push(node);
    }
  }
  eventNodes.push(...toolProjection.eventNodes);
  eventNodes.sort((left, right) => left.seq - right.seq);

  return {
    systemPrompts,
    eventNodes,
    eventLocations: new Map(),
    requests,
    callSchemas: callSchemas(records),
    partial: null,
    runningCalls: toolProjection.runningCalls,
  };
}

function inputNode(record) {
  const message = messageDetail(record.detail);
  const content = contentBlocks(message.content, record.input);
  const source = object(message.source);
  if (record.kind === "user") {
    return {
      kind: "user",
      seq: record.seq,
      time: timestamp(record.timeMillis),
      content,
      source: Object.keys(source).length ? source : { kind: "user" },
    };
  }
  return {
    kind: "context",
    seq: record.seq,
    time: timestamp(record.timeMillis),
    content,
    source: Object.keys(source).length ? source : { kind: record.source || "context" },
    producer: {
      role: record.source === "recall" ? "recall" : "inject",
      label: record.title || record.source || null,
    },
    form: knownContextForm(source.form),
  };
}

function assistantNode(record) {
  const turn = positiveInteger(record.turn);
  const step = positiveInteger(record.step);
  if (!turn || !step) return null;
  const detail = object(parseJson(record.detail));
  const message = object(detail.message || detail);
  const request = record.requests.find((item) => item.purpose === "assistant") || record.requests[0];
  const provider = request?.provider || stringValue(object(message.source).provider);
  const model = request?.model || stringValue(object(message.source).model);
  const blocks = array(message.content).map(assistantBlock).filter(Boolean);
  const fallback = record.output || record.preview;
  if (blocks.length === 0 && fallback) blocks.push({ kind: "text", text: fallback });
  const timing = assistantTiming(request, record);
  return {
    kind: "assistant",
    seq: record.seq,
    ...(stringValue(message.id) ? { messageId: stringValue(message.id) } : {}),
    time: timestamp(record.timeMillis),
    turn,
    step,
    blocks,
    ...(request?.usage ? { usage: officialUsage(request.usage) } : {}),
    ...(provider && model ? { providerMetadata: { provider, model } } : {}),
    ...(request?.requestConfig ? {
      requestConfig: officialRequestConfig(request.requestConfig, provider, model),
    } : {}),
    ...(timing ? { timing } : {}),
    ...(record.status === "cancelled" ? { interrupted: true } : {}),
  };
}

function assistantBlock(value) {
  const block = object(value);
  const type = stringValue(block.type);
  if (type === "text" || type === "reasoning") {
    return { kind: type, text: stringValue(block.text) };
  }
  if (type === "image" && validImageAttachment(block.attachment)) {
    return { kind: "image", attachment: block.attachment };
  }
  if (type === "tool-call") {
    return {
      kind: "tool-call",
      callId: stringValue(block.id || block.toolCallId),
      name: stringValue(block.name),
      argsRaw: typeof block.arguments === "string"
        ? block.arguments
        : stringifyValue(block.arguments),
    };
  }
  return { kind: "other", block: value };
}

function requestViews(records) {
  const bySeq = new Map();
  const compactionBySeq = new Map(
    records.filter((record) => record.kind === "compaction")
      .flatMap((record) => record.requests.map((request) => [request.seq, record])),
  );
  for (const record of records) {
    for (const request of record.requests) {
      if (bySeq.has(request.seq)) continue;
      const startedAt = timestamp(request.startedAt ?? request.timeMillis);
      const completedAt = request.status === "running"
        ? null
        : nullableTimestamp(request.completedAt)
          ?? (Number.isFinite(request.durationMillis) ? startedAt + request.durationMillis : null);
      const common = {
        startSeq: request.seq,
        startedAt,
        completedAt,
        status: request.status === "cancelled" ? "error" : request.status,
        ...(request.provider && request.model ? {
          providerMetadata: { provider: request.provider, model: request.model },
        } : {}),
        ...(request.requestConfig ? {
          requestConfig: officialRequestConfig(
            request.requestConfig,
            request.provider,
            request.model,
          ),
        } : {}),
        ...(request.usage ? { usage: officialUsage(request.usage) } : {}),
        ...(Number.isFinite(request.resultSeq) ? { resultSeq: request.resultSeq } : {}),
        context: request.context || [],
      };
      if (request.purpose === "assistant") {
        const turn = positiveInteger(request.turn);
        const step = positiveInteger(request.step);
        if (!turn || !step) continue;
        bySeq.set(request.seq, { ...common, purpose: "assistant", turn, step });
        continue;
      }
      const compaction = compactionBySeq.get(request.seq);
      const summary = contentBlocks([], compaction?.output || "");
      bySeq.set(request.seq, {
        ...common,
        purpose: "compaction",
        turn: positiveInteger(request.turn),
        step: 0,
        ...(summary.length ? { summary, rawOutput: summary } : {}),
        ...(Number.isFinite(request.resultSeq) ? { replacementSeq: request.resultSeq } : {}),
      });
    }
  }
  return [...bySeq.values()].sort((left, right) => left.startSeq - right.startSeq);
}

function projectTools(records) {
  const blocks = new Map();
  for (const record of records) {
    if (record.kind !== "tool") continue;
    const detail = object(parseJson(record.detail));
    const result = object(detail.result);
    const data = Object.keys(result).length ? result : detail;
    const parentCallId = stringValue(data.parentCallId || data.rootCallId);
    const callId = record.source || stringValue(data.callId || data.subCallId);
    if (!callId) continue;
    const argsRaw = record.input || stringifyValue(data.arguments || detail.call || {});
    const common = {
      callId,
      ...(parentCallId ? { parentCallId } : {}),
      name: record.title || stringValue(data.name) || "tool",
      turn: positiveInteger(record.turn) || 0,
      step: positiveInteger(record.step) || 0,
      time: timestamp(record.timeMillis),
      subCalls: [],
    };
    if (record.status === "running") {
      blocks.set(callId, { phase: "start", ...common, argsRaw });
      continue;
    }
    const resultEvent = lastRawEvent(record.rawJson);
    const resultMessage = object(object(resultEvent?.data).message);
    const messageContent = array(resultMessage.content);
    const resultBlock = object(messageContent.find((block) => object(block).type === "tool-result"));
    const content = contentBlocks(resultBlock.content || resultMessage.content || data.content, record.output);
    const error = officialToolError(data.error);
    blocks.set(callId, {
      kind: "tool-result",
      seq: nonnegativeInteger(resultEvent?.seq) ?? record.seq,
      time: timestamp(resultEvent?.time ?? completedTime(record)),
      callId,
      ...(parentCallId ? { parentCallId } : {}),
      call: { name: common.name, argsRaw },
      callTime: common.time,
      content,
      isError: record.status === "error",
      ...(error ? { error } : {}),
      ...(data.meta === undefined ? {} : { meta: data.meta }),
      subCalls: [],
    });
  }

  const project = (block, path = new Set()) => {
    if (path.has(block.callId)) return { ...block, subCalls: [] };
    const nextPath = new Set(path);
    nextPath.add(block.callId);
    const children = [...blocks.values()]
      .filter((candidate) => candidate.parentCallId === block.callId)
      .sort((left, right) => left.time - right.time)
      .map((child) => project(child, nextPath));
    return { ...block, subCalls: children };
  };
  const roots = [...blocks.values()]
    .filter((block) => !block.parentCallId || !blocks.has(block.parentCallId))
    .sort((left, right) => left.time - right.time)
    .map((block) => project(block));
  return {
    eventNodes: roots.filter((block) => block.kind === "tool-result"),
    runningCalls: roots.filter((block) => block.phase === "start"),
  };
}

function officialToolError(value) {
  const error = object(value);
  const code = stringValue(error.code);
  if (!code) return null;
  return {
    name: stringValue(error.name) || "Error",
    code,
    ...(stringValue(error.reason) ? { reason: stringValue(error.reason) } : {}),
  };
}

function callSchemas(records) {
  const result = new Map();
  for (const record of records) {
    if (record.kind !== "tool" || !record.source) continue;
    const schemas = record.requests.flatMap((request) => array(request.requestConfig?.tools));
    const schema = schemas.find((candidate) => {
      const item = object(candidate);
      return item.name === record.title || object(item.function).name === record.title;
    });
    if (schema !== undefined) result.set(record.source, normalizeToolSchema(schema));
  }
  return result;
}

function normalizeToolSchema(value) {
  const schema = object(value);
  const nested = object(schema.function);
  const source = Object.keys(nested).length ? nested : schema;
  return {
    name: stringValue(source.name),
    description: stringValue(source.description),
    parameters: object(source.parameters),
    ...(source.deferLoading === true ? { deferLoading: true } : {}),
  };
}

function officialRequestConfig(value, provider, model) {
  const config = object(value);
  return {
    ...config,
    provider: stringValue(config.provider) || provider || "",
    model: stringValue(config.model) || model || "",
  };
}

function officialUsage(value) {
  return {
    ...(Number.isFinite(value.input) ? { inputTokens: value.input } : {}),
    ...(Number.isFinite(value.cacheRead) ? { cacheReadTokens: value.cacheRead } : {}),
    ...(Number.isFinite(value.cacheWrite) ? { cacheWriteTokens: value.cacheWrite } : {}),
    ...(Number.isFinite(value.output) ? { outputTokens: value.output } : {}),
    ...(Number.isFinite(value.reasoning) ? { reasoningTokens: value.reasoning } : {}),
  };
}

function assistantTiming(request, record) {
  if (!Number.isFinite(request?.startedAt) || !Number.isFinite(request?.completedAt)) return null;
  return {
    stepStartTime: request.startedAt,
    firstTokenTime: Number.isFinite(request.firstTokenTime) ? request.firstTokenTime : null,
    completedTime: request.completedAt ?? timestamp(record.timeMillis),
  };
}

function contentBlocks(value, fallback) {
  const blocks = array(value).filter((block) => typeof block === "object" && block !== null);
  if (blocks.length) return blocks;
  return fallback ? [{ type: "text", text: fallback }] : [];
}

function messageDetail(value) {
  const detail = object(parseJson(value));
  return object(detail.message || detail);
}

function knownContextForm(value) {
  return ["instructions", "catalog", "snapshot", "notice", "relay", "recall"].includes(value)
    ? value
    : null;
}

function validImageAttachment(value) {
  const attachment = object(value);
  return typeof attachment.attachmentId === "string"
    && typeof attachment.mediaType === "string"
    && Number.isFinite(attachment.bytes)
    && Number.isFinite(attachment.width)
    && Number.isFinite(attachment.height);
}

function lastRawEvent(value) {
  const raw = parseJson(value);
  const events = Array.isArray(raw) ? raw : [raw];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = object(events[index]);
    if (event.type === "tool/result" || event.type === "tool/code-dispatch") return event;
  }
  return null;
}

function completedTime(record) {
  return Number.isFinite(record.timeMillis) && Number.isFinite(record.durationMillis)
    ? record.timeMillis + record.durationMillis
    : record.timeMillis;
}

function translateTrajectory(key, values = {}) {
  let text = zh[key] || key;
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function mergeLatest(current, next) {
  if (!current || current.runtimeThreadId !== next.runtimeThreadId) return next;
  const records = mergeRecords(current.records, next.records);
  return {
    ...next,
    records,
    hasMore: records.length < next.totalRecords,
    beforeIndex: records[0]?.index ?? null,
  };
}

function mergeOlder(current, older) {
  if (!current || current.runtimeThreadId !== older.runtimeThreadId) return older;
  const records = mergeRecords(older.records, current.records);
  return {
    ...current,
    records,
    hasMore: older.hasMore,
    beforeIndex: records[0]?.index ?? null,
  };
}

function mergeRecords(first, second) {
  return [...new Map([...first, ...second].map((record) => [record.id, record])).values()]
    .sort((left, right) => left.index - right.index);
}

function timestamp(value) {
  return Number.isFinite(value) ? value : 0;
}

function nullableTimestamp(value) {
  return Number.isFinite(value) ? value : null;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function parseJson(value) {
  if (typeof value !== "string" || value === "") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value ?? "");
  }
}

function noop() {}

function emptyRenderSlot() {
  return null;
}

function TrajectoryState({ text, action, onAction }) {
  return <div className="trajectory-state" role="status">
    <p>{text}</p>
    {action ? <button type="button" onClick={onAction}>{action}</button> : null}
  </div>;
}
