import React from 'react';

export function ShortcutsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { key: `${modKey} + Enter`, description: 'Generate transcript from current URL or ID' },
    { key: `${modKey} + K`, description: 'Focus YouTube URL / ID input field' },
    { key: `${modKey} + Shift + C`, description: 'Quick copy transcript to clipboard' },
    { key: `${modKey} + S`, description: 'Quick download transcript file' },
    { key: 'Esc', description: 'Close any open modal or clear search' },
    { key: '?', description: 'Open this keyboard shortcuts guide' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Power user guide</p>
            <h2>Keyboard Shortcuts</h2>
          </div>
          <button className="ghost-btn" onClick={onClose} aria-label="Close shortcuts dialog">
            Close
          </button>
        </div>

        <div className="shortcuts-table">
          {shortcuts.map((item, index) => (
            <div key={index} className="shortcut-row">
              <span className="shortcut-description">{item.description}</span>
              <kbd className="shortcut-badge">{item.key}</kbd>
            </div>
          ))}
        </div>

        <p className="small-text">Tip: Press <kbd className="inline-kbd">Esc</kbd> anytime to dismiss active dialogs.</p>
      </div>
    </div>
  );
}

