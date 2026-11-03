/**
 * Modern fintech Table suite (Linear / Ramp style)
 * Clean borders, subtle row hover, uppercase tracking headers, and tabular number support
 */
export function Table({ children, className = '', containerClassName = '', ...props }) {
  return (
    <div className={`w-full overflow-x-auto rounded-xl border border-slate-200/90 bg-white ${containerClassName}`}>
      <table className={`w-full text-left border-collapse text-xs ${className}`} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, className = '', ...props }) {
  return (
    <thead className={`bg-slate-50/80 border-b border-slate-200 text-slate-500 ${className}`} {...props}>
      {children}
    </thead>
  );
}

export function TableBody({ children, className = '', ...props }) {
  return (
    <tbody className={`divide-y divide-slate-100 text-slate-700 ${className}`} {...props}>
      {children}
    </tbody>
  );
}

export function TableRow({ children, className = '', hover = true, ...props }) {
  return (
    <tr
      className={`transition-colors duration-100 ${
        hover ? 'hover:bg-slate-50/70' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableHead({ children, align = 'left', className = '', ...props }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <th
      className={`py-3 px-4 text-[11px] font-semibold uppercase tracking-wider ${alignClass} ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({ children, align = 'left', isNumeric = false, className = '', ...props }) {
  const alignClass = align === 'right' || isNumeric ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const numClass = isNumeric ? 'font-mono tabular-nums' : '';

  return (
    <td className={`py-3 px-4 ${alignClass} ${numClass} ${className}`} {...props}>
      {children}
    </td>
  );
}

export function TableFooter({ children, className = '', ...props }) {
  return (
    <tfoot className={`bg-slate-50/80 border-t border-slate-200 text-slate-700 font-medium ${className}`} {...props}>
      {children}
    </tfoot>
  );
}

export default Table;
