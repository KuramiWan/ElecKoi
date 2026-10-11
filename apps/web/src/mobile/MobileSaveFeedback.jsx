import { useEffect, useRef } from 'react';

export function MobileSaveFeedback({ error, notice, onNotify, successMessage = '已保存' }) {
  const notifyRef = useRef(onNotify);
  const previous = useRef(null);
  notifyRef.current = onNotify;
  useEffect(() => {
    const feedback = error ? { type: 'error', message: error }
      : notice === 'saved' ? { type: 'success', message: successMessage } : null;
    const key = feedback ? JSON.stringify(feedback) : null;
    if (key !== previous.current) {
      previous.current = key;
      if (feedback) notifyRef.current(feedback.type, feedback.message);
    }
  }, [error, notice, successMessage]);
  return null;
}
