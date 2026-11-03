import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Global Keyboard Shortcut hook for accounting and compliance power-users.
 * Supported:
 * - Ctrl + N / Cmd + N: New Sales Invoice
 * - Ctrl + B / Cmd + B: New Purchase Bill
 * - Ctrl + K / Cmd + K: Taxpayer GSTIN Search
 * - Shift + ? : Open Shortcuts Cheat Sheet
 */
export function useKeyboardShortcuts({ onOpenShortcuts } = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(event) {
      // Ignore when typing inside an input, textarea, or contentEditable element
      const target = event.target;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? event.metaKey : event.ctrlKey;

      if (modifier && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        navigate('/sales/invoices');
        return;
      }

      if (modifier && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        navigate('/purchases/bills');
        return;
      }

      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/taxpayer-search');
        return;
      }

      if (!isInput && event.key === '?') {
        event.preventDefault();
        onOpenShortcuts?.();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, onOpenShortcuts]);
}
