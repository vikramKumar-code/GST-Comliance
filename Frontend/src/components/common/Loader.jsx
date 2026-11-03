/**
 * Reusable animated Loader component with optional message and sizes
 */
export default function Loader({ message = 'Loading...', size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  };

  return (
    <div className={`flex flex-col items-center justify-center p-6 text-center ${className}`}>
      <div
        className={`animate-spin rounded-full border-slate-200 border-t-indigo-600 ${sizeClasses[size] || sizeClasses.md}`}
        role="status"
        aria-label="Loading"
      />
      {message && (
        <p className="mt-3 text-xs font-medium text-slate-500 animate-pulse tracking-wide">
          {message}
        </p>
      )}
    </div>
  );
}
