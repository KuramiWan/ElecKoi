import { useEffect, useRef } from 'react';
import { ChatWallpaperLayer } from '../modules/chat/index.js';

const textEditors = '[data-composer-input], .message-inline-editor textarea';

/** Editor focus preserves the DSH caret; only a text press requests the Android IME. */
export function MobileConversationPage({ children, wallpaper }) {
  const inputModes = useRef(new Map());
  const requestedInput = useRef(null);
  const root = useRef(null);
  useEffect(() => {
    function suspendInput() {
      requestedInput.current = null;
      for (const input of root.current?.querySelectorAll(textEditors) ?? []) suppressKeyboard(input);
      for (const input of inputModes.current.keys()) {
        if (!root.current?.contains(input)) inputModes.current.delete(input);
      }
    }
    document.addEventListener('visibilitychange', suspendInput);
    window.addEventListener('blur', suspendInput);
    window.addEventListener('focus', suspendInput);
    window.addEventListener('pagehide', suspendInput);
    return () => {
      document.removeEventListener('visibilitychange', suspendInput);
      window.removeEventListener('blur', suspendInput);
      window.removeEventListener('focus', suspendInput);
      window.removeEventListener('pagehide', suspendInput);
      for (const [input, mode] of inputModes.current) {
        if (mode === null) input.removeAttribute('inputmode');
        else input.setAttribute('inputmode', mode);
      }
      inputModes.current.clear();
    };
  }, []);

  function suppressKeyboard(input) {
    if (!inputModes.current.has(input)) inputModes.current.set(input, input.getAttribute('inputmode'));
    input.setAttribute('inputmode', 'none');
  }

  function focusInput(event) {
    const input = event.target;
    if (input instanceof Element && input.matches(textEditors) && requestedInput.current !== input) {
      suppressKeyboard(input);
    }
  }

  function selectInputMode(event) {
    if (!(event.target instanceof Element)) return;
    const textArea = event.target.closest('[data-input-scroll]');
    const input = event.target.closest(textEditors) ?? textArea?.querySelector('[data-composer-input]');
    if (!input || event.target.closest('button')) {
      requestedInput.current = null;
      for (const editor of root.current?.querySelectorAll(textEditors) ?? []) suppressKeyboard(editor);
    } else {
      requestedInput.current = input;
      if (inputModes.current.has(input)) {
        const mode = inputModes.current.get(input);
        if (mode === null) input.removeAttribute('inputmode');
        else input.setAttribute('inputmode', mode);
      }
    }
  }

  return <div ref={root} className={`mobile-conversation-page${wallpaper?.image ? ' has-chat-wallpaper' : ''}`} onPointerDownCapture={selectInputMode}
    onMouseDownCapture={selectInputMode} onClickCapture={selectInputMode} onFocusCapture={focusInput}>
    <ChatWallpaperLayer wallpaper={wallpaper} />
    {children}
  </div>;
}
