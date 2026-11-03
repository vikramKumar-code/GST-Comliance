import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import KeyboardShortcutsModal from '../common/KeyboardShortcutsModal';

/**
 * Modern modular MainLayout component with responsive drawer, footer, and power-user hotkeys
 */
export default function MainLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  useKeyboardShortcuts({
    onOpenShortcuts: () => setShortcutsModalOpen(true),
  });

  return (
    <div className="zoho-app-shell">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="zoho-main-content">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="zoho-page-body animate-in fade-in duration-150 flex-grow-1">
          <Breadcrumbs />
          {children}
        </main>
        <footer className="bg-white border-t border-slate-200/90 py-3.5 px-6 text-slate-500 text-xs flex justify-between items-center flex-wrap gap-2">
          <span className="text-slate-400">
            © {new Date().getFullYear()} CandidTax • Enterprise GST Compliance & Billing Platform
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setShortcutsModalOpen(true)}
              className="text-slate-500 hover:text-indigo-600 transition flex items-center gap-1 cursor-pointer"
              title="View power-user keyboard shortcuts"
            >
              <span>Shortcuts</span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono text-[10px] text-slate-600">?</kbd>
            </button>
            <Link to="/privacy" className="text-slate-500 hover:text-indigo-600 transition text-decoration-none">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-slate-500 hover:text-indigo-600 transition text-decoration-none">
              Terms of Service
            </Link>
          </div>
        </footer>
      </div>

      <KeyboardShortcutsModal
        isOpen={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />
    </div>
  );
}
