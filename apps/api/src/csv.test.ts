import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks per RFC 4180', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(' padded')).toBe('" padded"');
  });

  it('defuses spreadsheet formulas but leaves negative decimals as numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-0.00265663')).toBe('-0.00265663');
    expect(csvCell('+1')).toBe("'+1");
  });

  it('renders nulls as empty cells and scalars as text', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(3)).toBe('3');
    expect(csvCell(true)).toBe('true');
  });
});

describe('toCsv', () => {
  it('writes a header and CRLF-terminated rows', () => {
    expect(toCsv(['a', 'b'], [['1', null], ['x,y', 2]])).toBe('a,b\r\n1,\r\n"x,y",2\r\n');
  });
});
