import { useEffect, useRef, useState } from "react";
import { SettingLibraryResizer } from "./SettingLibraryResizer.jsx";
import { DEFAULT_INSPECTOR_WIDTH, inspectorWidthBounds } from "../model/settingLibraryInspectorSizing.js";
import { useInspectorPresence } from "../model/useInspectorPresence.js";

export function BranchSettingsSplitView({ children, preferredWidth, onWidthChange }) {
  const layoutRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(() => window.innerWidth || 1024);
  const [drag, setDrag] = useState(null);
  const presence = useInspectorPresence(children[1]);
  const inspectorOpen = Boolean(presence.content);
  const { min, max } = inspectorWidthBounds(containerWidth);
  const width = Math.min(max, Math.max(min, preferredWidth));

  useEffect(() => {
    if (!inspectorOpen) setDrag(null);
  }, [inspectorOpen]);

  useEffect(() => {
    const layout = layoutRef.current;
    const measure = () => {
      const measured = layout.getBoundingClientRect().width;
      if (measured > 0) setContainerWidth(measured);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(layout);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (!drag) return undefined;
    const move = (event) => {
      if (event.pointerId !== drag.pointerId) return;
      onWidthChange(Math.min(max, Math.max(min, drag.width + drag.x - event.clientX)));
    };
    const finish = (event) => {
      if (event.type !== "blur" && event.pointerId !== drag.pointerId) return;
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  }, [drag, min, max, onWidthChange]);

  const reset = () => onWidthChange(DEFAULT_INSPECTOR_WIDTH);
  return (
    <div ref={layoutRef} className={`dynamic-settings-editor-layout${inspectorOpen ? " is-inspector-open" : ""}${drag ? " is-resizing" : ""}`}
      style={{ "--setting-library-inspector-width": `${width}px` }}>
      {children[0]}
      {inspectorOpen ? (
      <div className={`dynamic-settings-editor-pane inspector-presence${presence.closing ? ' is-closing' : ''}`}
        inert={presence.closing} onAnimationEnd={presence.onAnimationEnd}>
        <SettingLibraryResizer aria-label="调整编辑器宽度"
          aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(width)}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDrag({ x: event.clientX, width, pointerId: event.pointerId });
          }}
          onLostPointerCapture={() => setDrag(null)}
          onDoubleClick={reset}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 48 : 24;
            const next = { ArrowLeft: width + step, ArrowRight: width - step, Home: min, End: max }[event.key];
            if (next !== undefined) {
              event.preventDefault();
              onWidthChange(Math.min(max, Math.max(min, next)));
            } else if (event.key === "Enter") {
              event.preventDefault();
              reset();
            } else if (event.key === "Escape") {
              setDrag(null);
            }
          }} />
        {presence.content}
      </div>
      ) : null}
    </div>
  );
}
