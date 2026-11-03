import { X, Command, Keyboard } from 'lucide-react';
import Button from '../ui/Button';

export default function KeyboardShortcutsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modKey = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { key: `${modKey} + N`, label: 'New Sales Invoice', path: '/sales/invoices' },
    { key: `${modKey} + B`, label: 'Record Purchase Bill', path: '/purchases/bills' },
    { key: `${modKey} + K`, label: 'Search & Verify 15-Digit GSTIN', path: '/taxpayer-search' },
    { key: 'Shift + ?', label: 'Open Keyboard Shortcuts Guide' },
    { key: 'Esc', label: 'Close Active Modal / Dropdown' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Power-User Keyboard Shortcuts</h3>
              <p className="text-[11px] text-slate-500">Accelerate your daily billing & return workflows</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {shortcuts.map((sc, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/80 border border-slate-100 text-xs"
            >
              <span className="font-medium text-slate-700">{sc.label}</span>
              <kbd className="px-2 py-1 rounded-md bg-white border border-slate-300 font-mono text-[11px] font-bold text-slate-800 shadow-2xs">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="pt-2 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Got it (Esc)
          </Button>
        </div>
      </div>
    </div>
  );
}
