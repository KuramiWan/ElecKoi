export function FrontendDiagnostics({ messages }) {
  if (!messages.length) return null;
  return <details className="rich-message-diagnostics"><summary>页面运行提示</summary>
    {messages.map(message => <pre key={message}>{message}</pre>)}
  </details>;
}
import './frontend-diagnostics.css';
