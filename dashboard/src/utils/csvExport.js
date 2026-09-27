// src/utils/csvExport.js
//
// Small, dependency-free CSV export. Two entry points:
//  - toCsv(rows): array of plain objects -> CSV string. Columns are the
//    union of keys across all rows (not just the first row's keys), so
//    a row missing a field doesn't silently shift every column after it.
//  - downloadCsv(filename, rows): builds the CSV and triggers a browser
//    download via a Blob + throwaway <a download> link.

function escapeCsvValue(val) {
  if (val == null) return '';
  const str = String(val);
  // Quote (and escape internal quotes) whenever the value itself could
  // be mistaken for a delimiter or would break a line.
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(rows) {
  if (!rows || rows.length === 0) return '';

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach(k => set.add(k));
      return set;
    }, new Set())
  );

  const lines = [headers.map(escapeCsvValue).join(',')];
  rows.forEach(row => {
    lines.push(headers.map(h => escapeCsvValue(row[h])).join(','));
  });
  return lines.join('\n');
}

export function downloadCsv(filename, rows) {
  const csv = toCsv(rows);
  if (!csv) return false;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}