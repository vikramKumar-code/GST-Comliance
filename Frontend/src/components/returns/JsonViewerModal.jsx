import { useState } from 'react';
import { createPortal } from 'react-dom';
import { FileCode2, X, Check, Copy, Download, FileText } from 'lucide-react';
import Button from '../ui/Button';
import useFocusTrap from '../../hooks/useFocusTrap';
import { safeCopyToClipboard, downloadOfflineJson, downloadTallyXml } from '../../utils/returnHelpers';

/**
 * Raw JSON Payload Viewer & Export Modal
 */
export function JsonViewerModal({
  isOpen,
  onClose,
  prepareData,
  authGstin,
  period
}) {
  const [copiedJson, setCopiedJson] = useState(false);
  const modalRef = useFocusTrap(isOpen, onClose);

  if (!isOpen) return null;

  const payload = prepareData?.payload || {};

  const handleCopy = async () => {
    const success = await safeCopyToClipboard(JSON.stringify(payload, null, 2));
    if (success) {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } else {
      alert('Failed to copy to clipboard. Please try again.');
    }
  };

  const handleDownloadOfflineJson = () => {
    const success = downloadOfflineJson(prepareData, authGstin, period);
    if (!success) {
      alert('Failed to download file. Please try again.');
    }
  };

  const handleDownloadTallyXml = () => {
    const success = downloadTallyXml(prepareData, authGstin, period);
    if (!success) {
      alert('Failed to download XML file. Please try again.');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="json-viewer-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-4xl max-h-[85vh] bg-surface-dark text-slate-100 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-700"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-brand-400" />
            <h3 id="json-viewer-title" className="font-bold text-sm text-white">
              Official GSTN GSTR-1 Payload
            </h3>
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-white cursor-pointer"
            onClick={onClose}
            aria-label="Close JSON viewer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Code View */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-brand-300 bg-slate-950">
          <pre>{JSON.stringify(payload, null, 2)}</pre>
        </div>

        {/* Actions Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              {copiedJson ? (
                <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 mr-1.5" />
              )}
              <span>{copiedJson ? 'Copied!' : 'Copy JSON'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadOfflineJson}
              className="border-indigo-500/50 text-indigo-300 hover:bg-indigo-950/60"
            >
              <Download className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
              <span>Download GST Offline JSON</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadTallyXml}
              className="border-emerald-500/50 text-emerald-300 hover:bg-emerald-950/60"
            >
              <FileText className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
              <span>Download Tally XML</span>
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default JsonViewerModal;

