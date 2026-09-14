const DECIMAL = /^-?\d+(\.\d+)?$/;

export type CsvValue = string | number | boolean | null | undefined;

/**
 * One RFC 4180 cell. Text a spreadsheet would evaluate as a formula (=, +, -, @) gets an
 * apostrophe prefix; plain decimals, including negative quantities, are left intact.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && !DECIMAL.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
