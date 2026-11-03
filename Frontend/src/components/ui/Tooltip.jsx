import { useState } from 'react';

/**
 * Lightweight, accessible Tooltip component
 */
export function Tooltip({
  content,
  children,
  position = 'top', // 'top' | 'bottom' | 'left' | 'right'
  className = '',
}) {
  const [visible, setVisible] = useState(false);

  if (!content) return children;

  const POSITION_STYLES = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className={`absolute z-50 px-2.5 py-1 text-[11px] font-medium text-white bg-slate-900 rounded-md shadow-md whitespace-nowrap pointer-events-none transition-opacity duration-150 animate-in fade-in ${
            POSITION_STYLES[position] || POSITION_STYLES.top
          }`}
        >
          {content}
        </div>
      )}
    </div>
  );
}

export default Tooltip;
