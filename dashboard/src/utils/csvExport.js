








function escapeCsvValue(val) {
  if (val == null) return '';
  const str = String(val);


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