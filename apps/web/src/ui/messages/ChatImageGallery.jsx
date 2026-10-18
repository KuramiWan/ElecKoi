import { X, ArrowClockwise } from "../icons/interfaceIcons.jsx";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SystemBarOverlay } from "../ui/SystemBarOverlay.jsx";
import { registerOverlayBack } from "../hooks/overlayBack.js";
import { FailureAlert } from "../ui/FailureAlert.jsx";
import "./chat-image-actions.css";

export function agentMessageImageSize(width, height) {
  if (!(width > 0) || !(height > 0)) return { width: 240, height: 240, objectPosition: "center" };
  const naturalRatio = width / height;
  const ratio = Math.min(4, Math.max(0.25, naturalRatio));
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 };
  const scale = Math.min(1, width / box.width, height / box.height);
  return { width: Math.max(1, Math.round(box.width * scale)), height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: naturalRatio < 0.25 ? "center top" : naturalRatio > 4 ? "left center" : "center" };
}
export function ChatImageGallery({ images = [], conversationId = "", compact = false, agentMessage = false, onRemove, loadImage, onRegenerateImage }) {
  if (!images.length) return null;
  const agentVariant = agentMessage ? images.length > 1 ? "tile" : "single" : "";
  return <div className={`chat-image-gallery${compact ? " compact" : ""}${agentMessage ? " agent-message-images" : ""}`} aria-label={compact ? "待发送图片" : "消息图片"}>
    {images.map(image => <ChatImage key={image.id || image.renderKey || image.localId || image.attachmentId}
      image={image} conversationId={conversationId} compact={compact} agentVariant={agentVariant}
      onRemove={onRemove} loadImage={loadImage} onRegenerateImage={onRegenerateImage} />)}
  </div>;
}

function ChatImage({ image, conversationId, compact, agentVariant, onRemove, loadImage, onRegenerateImage }) {
  const [source, setSource] = useState(image.previewUrl || image.dataUrl || "");
  const [failed, setFailed] = useState(false), [naturalSize, setNaturalSize] = useState(null);
  const [overlay, setOverlay] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const press = useRef(null), longPressed = useRef(false);
  const generating = busy || image.status === "generating";
  const canRegenerate = Boolean(image.batchId && onRegenerateImage && !generating);
  const fit = agentVariant === "single" ? agentMessageImageSize(image.width || naturalSize?.width, image.height || naturalSize?.height) : null;
  const label = image.name || (image.frameId ? `图片 ${image.frameId}` : "图片");
  const generationFailed = image.status === "failed";

  useEffect(() => {
    const immediate = image.previewUrl || image.dataUrl || "";
    setFailed(false); setSource(immediate);
    if (immediate || !conversationId || !image.attachmentId) return;
    let active = true;
    if (!loadImage) { setFailed(true); return; }
    loadImage(conversationId, image).then(url => { if (active) setSource(url); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [conversationId, image.attachmentId, image.dataUrl, image.previewUrl, loadImage]);
  useEffect(() => () => clearTimeout(press.current?.timer), []);

  const stopPress = () => { clearTimeout(press.current?.timer); press.current = null; };
  const regenerate = async () => {
    if (!canRegenerate) return;
    stopPress(); longPressed.current = false; setOverlay(""); setError(null); setBusy(true);
    try { await onRegenerateImage(image); } catch (failure) { setError(failure ?? "图片重新生成失败。"); }
    finally { setBusy(false); }
  };
  const download = () => {
    if (!source) return;
    const anchor = document.createElement("a");
    anchor.href = source; anchor.download = image.name || `image-${image.frameId || "download"}.png`;
    anchor.click(); longPressed.current = false; setOverlay("");
  };
  return <>
    <figure className={`chat-image-item${failed || generationFailed ? " failed" : ""}${agentVariant ? ` agent-${agentVariant}` : ""}${!compact ? " interactive-image" : ""}`}
      style={fit ? { width: `${fit.width}px`, aspectRatio: `${fit.width} / ${fit.height}` } : undefined}
      role={compact ? undefined : "button"} tabIndex={compact ? undefined : 0}
      aria-label={compact ? undefined : generationFailed ? `${label}生成失败` : `查看${label}`}
      onClick={event => { event.stopPropagation(); if (event.target.closest("button") || compact) return; if (longPressed.current) { longPressed.current = false; return; } if (source && !generating) setOverlay("preview"); }}
      onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" && source) setOverlay("preview"); if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); setOverlay("menu"); } }}
      onContextMenu={event => { if (compact) return; event.preventDefault(); longPressed.current = true; stopPress(); setOverlay("menu"); }}
      onPointerDown={event => { if (compact || event.button !== 0 || event.target.closest("button")) return; longPressed.current = false;
        press.current = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { longPressed.current = true; setOverlay("menu"); }, 500) }; }}
      onPointerMove={event => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) stopPress(); }}
      onPointerUp={stopPress} onPointerCancel={stopPress}>
      {source && !generating ? <img src={source} alt={label} draggable="false" onError={() => { setSource(""); setFailed(true); }}
        style={fit ? { objectPosition: fit.objectPosition } : undefined}
        onLoad={event => { if (agentVariant === "single") setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }} />
        : generating ? <span aria-label={`${label}生成中`} />
        : generationFailed ? <div className="chat-image-failure" title={image.error}>
          {canRegenerate ? <button className="chat-image-retry" type="button" onClick={regenerate}><ArrowClockwise size={22} aria-hidden="true" />重新生成</button> : <span>生成失败</span>}
        </div> : <span aria-label={failed ? `${label}加载失败` : `${label}加载中`} />}
      {compact && onRemove ? <button type="button" onClick={() => onRemove(image.localId)} aria-label={`移除${label}`} title="移除图片"><X size={12} weight="bold" aria-hidden="true" /></button> : null}
    </figure>
    <FailureAlert failure={error} className="chat-image-action-error" />
    {overlay ? <ImageOverlay kind={overlay} source={source} label={label} onClose={() => { longPressed.current = false; setOverlay(""); }}
      onDownload={source ? download : undefined} onRegenerate={canRegenerate ? regenerate : undefined} /> : null}
  </>;
}

function ImageOverlay({ kind, source, label, onClose, onDownload, onRegenerate }) {
  const root = useRef(null), [zoom, setZoom] = useState(1);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector("button")?.focus();
    const stop = registerOverlayBack(() => { onClose(); return true; }, window, 1300);
    return () => { stop(); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  return createPortal(<SystemBarOverlay className={`chat-image-overlay ${kind === "preview" ? "image-preview" : "image-menu"}`}
    onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={root} role="dialog" aria-modal="true" aria-label={kind === "preview" ? "图片预览" : "图片菜单"}
      className={kind === "preview" ? "chat-image-preview" : "chat-image-menu"}
      onKeyDown={event => { if (event.key !== "Tab") return; const buttons = [...root.current.querySelectorAll("button")]; const next = (buttons.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length; event.preventDefault(); buttons[next]?.focus(); }}>
      {kind === "preview" ? <>
        <div className="chat-image-preview-canvas" onDoubleClick={() => setZoom(value => value === 1 ? 2 : 1)}>
          <img src={source} alt={label} style={{ width: zoom === 1 ? "auto" : `${zoom * 100}%`, maxWidth: zoom === 1 ? "100%" : "none", maxHeight: zoom === 1 ? '100%' : 'none' }} />
        </div>
        <div className="chat-image-preview-controls"><button type="button" onClick={() => setZoom(value => value === 1 ? 2 : 1)}>{zoom === 1 ? "放大" : "还原"}</button>
          <button type="button" onClick={onClose} aria-label="关闭图片预览"><X size={20} aria-hidden="true" />关闭</button></div>
      </> : <>
        {onDownload ? <button type="button" onClick={onDownload}>下载图片</button> : null}
        {onRegenerate ? <button type="button" onClick={onRegenerate}>重新生成</button> : null}
        <button type="button" onClick={onClose}>取消</button>
      </>}
    </div>
  </SystemBarOverlay>, document.body);
}
