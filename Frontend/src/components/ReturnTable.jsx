import { formatCurrency } from '../utils/format';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell
} from './ui/Table';

export default function ReturnTable({ rows = [], totals }) {
  return (
    <div className="bg-surface rounded-xl border border-surface-border shadow-xs overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="py-3 px-4 font-semibold text-slate-700">Description / Return Section</TableHead>
            <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">Taxable Amount (₹)</TableHead>
            <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">IGST (₹)</TableHead>
            <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">CGST (₹)</TableHead>
            <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">SGST (₹)</TableHead>
            <TableHead className="text-right py-3 px-4 font-semibold text-slate-700">Cess (₹)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-slate-400">
                No return data available for this period.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, idx) => (
              <TableRow key={idx} className="hover:bg-slate-50/50 transition-colors">
                <TableCell className="font-medium text-slate-900 py-3 px-4">{row.label}</TableCell>
                <TableCell className="text-right font-mono py-3 px-4 font-medium">{formatCurrency(row.taxable || 0)}</TableCell>
                <TableCell className="text-right font-mono py-3 px-4 text-slate-600">{formatCurrency(row.igst || 0)}</TableCell>
                <TableCell className="text-right font-mono py-3 px-4 text-slate-600">{formatCurrency(row.cgst || 0)}</TableCell>
                <TableCell className="text-right font-mono py-3 px-4 text-slate-600">{formatCurrency(row.sgst || 0)}</TableCell>
                <TableCell className="text-right font-mono py-3 px-4 text-slate-600">{formatCurrency(row.cess || 0)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {totals && (
          <TableFooter>
            <TableRow className="bg-slate-50/80 font-bold border-t-2 border-surface-border">
              <TableCell className="py-3 px-4 text-slate-900">Total Liability / Credit</TableCell>
              <TableCell className="text-right font-mono py-3 px-4 text-slate-900">{formatCurrency(totals.taxable || 0)}</TableCell>
              <TableCell className="text-right font-mono py-3 px-4 text-slate-900">{formatCurrency(totals.igst || 0)}</TableCell>
              <TableCell className="text-right font-mono py-3 px-4 text-slate-900">{formatCurrency(totals.cgst || 0)}</TableCell>
              <TableCell className="text-right font-mono py-3 px-4 text-slate-900">{formatCurrency(totals.sgst || 0)}</TableCell>
              <TableCell className="text-right font-mono py-3 px-4 text-slate-900">{formatCurrency(totals.cess || 0)}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
