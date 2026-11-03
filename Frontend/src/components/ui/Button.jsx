import { forwardRef } from 'react';

/**
 * Modern fintech Button component with Linear/Stripe styling
 * Variants: primary, secondary, outline, ghost, danger, success
 * Sizes: xs, sm, md, lg
 */
export const Button = forwardRef(function Button(
  {
    children,
    type = 'button',
    variant = 'primary',
    size = 'md',
    isLoading = false,
    disabled = false,
    leftIcon = null,
    rightIcon = null,
    className = '',
    ...props
  },
  ref
) {
  const baseClasses =
    'inline-flex items-center justify-center font-medium transition-all duration-150 select-none focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

  const variantClasses = {
    primary:
      'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-xs focus:ring-2 focus:ring-indigo-500/20 border border-indigo-700/20',
    secondary:
      'bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 border border-slate-200/80 shadow-2xs',
    outline:
      'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-300 shadow-2xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10',
    ghost:
      'bg-transparent hover:bg-slate-100 active:bg-slate-200 text-slate-600 hover:text-slate-900 border border-transparent',
    danger:
      'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-xs border border-rose-700/20 focus:ring-2 focus:ring-rose-500/20',
    success:
      'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-xs border border-emerald-700/20 focus:ring-2 focus:ring-emerald-500/20',
  };

  const sizeClasses = {
    xs: 'text-[11px] px-2 py-1 rounded-md gap-1',
    sm: 'text-xs px-2.5 py-1.5 rounded-lg gap-1.5',
    md: 'text-xs px-3.5 py-2 rounded-lg gap-2',
    lg: 'text-sm px-4 py-2.5 rounded-xl gap-2.5 font-semibold',
  };

  const isBtnDisabled = disabled || isLoading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isBtnDisabled}
      className={`${baseClasses} ${variantClasses[variant] || variantClasses.primary} ${
        sizeClasses[size] || sizeClasses.md
      } ${className}`}
      {...props}
    >
      {isLoading ? (
        <span
          className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"
          aria-hidden="true"
        />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      <span>{children}</span>
      {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
});

export default Button;
