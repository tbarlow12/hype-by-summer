// CSV building with spreadsheet formula-injection protection. Pure.

export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = Array.isArray(value) ? value.join("; ") : value instanceof Date ? value.toISOString() : String(value);
  // Cells starting with these are treated as formulas by Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
