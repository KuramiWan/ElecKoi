export function EditorLibraryGroup({ className = '', title, subtitle, count, actions, children, ...props }) {
  return <section {...props} className={`editor-library-group ${className}`} aria-label={title}>
    <header className="editor-library-header">
      <div className="editor-library-heading">
        <strong>{title}</strong>{subtitle && <span className="editor-library-context" title={subtitle}>{subtitle}</span>}{count !== undefined && <span className="editor-library-count">{count}</span>}
      </div>
      {actions}
    </header>
    <div className="editor-library-rows">{children}</div>
  </section>;
}
