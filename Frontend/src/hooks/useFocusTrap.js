import { useEffect, useRef } from 'react';

/**
 * Custom hook to trap focus inside a modal dialog and handle Escape key
 * @param {boolean} isOpen
 * @param {Function} onEscape
 * @param {React.RefObject} [customRef]
 * @returns {React.RefObject}
 */
export function useFocusTrap(isOpen, onEscape, customRef = null) {
  const localRef = useRef(null);
  const ref = customRef || localRef;
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!isOpen || !ref.current) return;

    const focusableElements = ref.current.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (onEscapeRef.current) onEscapeRef.current();
        return;
      }

      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, ref]);

  return ref;
}

export default useFocusTrap;
