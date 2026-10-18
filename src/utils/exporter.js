/**
 * 导出：轨迹 CSV / 画面 PNG
 */

const CSV_HEADER = [
  't',
  'x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'x3', 'y3', 'z3',
  'vx1', 'vy1', 'vz1', 'vx2', 'vy2', 'vz2', 'vx3', 'vy3', 'vz3',
].join(',');

function num(v) {
  if (!isFinite(v)) return '';
  return Number(v.toPrecision(12)).toString();
}

export function buildTraceCSV(world) {
  const rows = [CSV_HEADER];
  world.trace.forEach((row) => {
    const cells = new Array(row.length);
    for (let i = 0; i < row.length; i++) cells[i] = num(row[i]);
    rows.push(cells.join(','));
  });
  return rows.join('\r\n');
}

export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff' + text], { type: mime });
  triggerDownload(filename, URL.createObjectURL(blob));
}

export function downloadDataURL(filename, dataURL) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerDownload(filename, url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function timestampName(prefix, ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
  return `${prefix}-${stamp}.${ext}`;
}
