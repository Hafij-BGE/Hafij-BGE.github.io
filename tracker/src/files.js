// Helpers for the PhD application folders: names, sizes, folder trees, README rendering, zip export.
import { zipSync, strToU8 } from 'fflate';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "01_Program_Info" → "Program Info"; the stored name keeps the number so folders stay in order.
export const prettyFolder = name => String(name || '').replace(/^\d+[\s._-]+/, '').replace(/[_]+/g, ' ').trim() || name;
export const lastPart = path => String(path || '').split('/').pop();
export const parentOf = path => String(path || '').split('/').slice(0, -1).join('/');

// Characters Windows, macOS and Android all accept in a file or folder name.
export const cleanName = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 140);

export function fmtSize(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0) + ' MB';
}

export function extOf(name) { const m = /\.([a-z0-9]{1,6})$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
export function fileKind(f) {
  const e = extOf(f.name), t = f.type || '';
  if (t.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp'].includes(e)) return 'image';
  if (e === 'pdf' || t === 'application/pdf') return 'pdf';
  if (['md', 'markdown'].includes(e)) return 'md';
  if (['txt', 'csv', 'tsv', 'json', 'bib', 'tex', 'log', 'yaml', 'yml'].includes(e) || t.startsWith('text/')) return 'text';
  if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(e)) return 'doc';
  if (['xls', 'xlsx', 'ods', 'numbers'].includes(e)) return 'sheet';
  if (['ppt', 'pptx', 'odp', 'key'].includes(e)) return 'slides';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(e)) return 'zip';
  return 'file';
}
// Only these open inside the app. Everything else is downloaded, never run.
export function viewable(f) {
  const k = fileKind(f);
  return k === 'md' || k === 'text' || (k === 'image' && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extOf(f.name)));
}

// Junk the operating system leaves in folders.
export const isJunk = name => /^(\.|~\$|Thumbs\.db$|desktop\.ini$|\.DS_Store$)/i.test(name);

// All folders of one application: those created explicitly plus every folder that holds a file.
export function folderSet(app, files) {
  const set = new Set();
  const add = p => { const parts = String(p || '').split('/').filter(Boolean); for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/')); };
  (app.folders || []).forEach(add);
  files.forEach(f => add(f.folder));
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}
export const childFolders = (all, parent) => all.filter(p => parentOf(p) === parent);
export const inFolder = (files, folder) => files.filter(f => (f.folder || '') === folder)
  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
export const underFolder = (files, folder) => files.filter(f => (f.folder || '') === folder || (f.folder || '').startsWith(folder + '/'));

/* ---------- a small, safe Markdown renderer for README files ---------- */
// Everything is escaped first; only http(s) and mailto links are made clickable.
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  t = t.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (m, a, h) => `<a href="${h}" target="_blank" rel="noopener">${a}</a>`);
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, p, h) => `${p}<a href="${h}" target="_blank" rel="noopener">${h}</a>`);
  return t;
}
export function mdToHtml(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = []; let list = null, para = [], code = null, table = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`); list = null; } };
  const flushTable = () => {
    if (!table) return;
    const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r));
    const cells = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => inline(c.trim()));
    out.push(`<div class="mdtable"><table>${rows.map((r, i) => `<tr>${cells(r).map(c => i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>`);
    table = null;
  };
  const flush = () => { flushPara(); flushList(); flushTable(); };
  for (const line of lines) {
    if (code !== null) { if (/^\s*```/.test(line)) { out.push(`<pre>${esc(code.join('\n'))}</pre>`); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flush(); code = []; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); (table ||= []).push(line); continue; } else flushTable();
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); const n = Math.min(6, m[1].length + 2); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    if ((m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line))) {
      flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(`<li class="task"><input type="checkbox" disabled ${m[1] !== ' ' ? 'checked' : ''}> ${inline(m[2])}</li>`); continue;
    }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flush(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if (!line.trim()) { flush(); continue; }
    flushList(); para.push(line);
  }
  if (code !== null) out.push(`<pre>${esc(code.join('\n'))}</pre>`);
  flush();
  return out.join('');
}

/* ---------- zip export: the same folder layout as on the computer ---------- */
const STORED = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'zip', 'rar', '7z', 'gz', 'heic', 'odt', 'ods']);
export function buildZip(entries) {
  // entries: [{ path, data: Uint8Array | string }] or [{ path, dir: true }]
  const tree = {}, used = new Set();
  for (const e of entries) {
    if (e.dir) { if (!used.has(e.path.toLowerCase())) tree[e.path] = {}; continue; }   // an empty folder
    let path = e.path, n = 1;
    while (used.has(path.toLowerCase())) { const d = path.lastIndexOf('.'); path = d > path.lastIndexOf('/') ? `${e.path.slice(0, d)} (${++n})${e.path.slice(d)}` : `${e.path} (${++n})`; }
    used.add(path.toLowerCase());
    const data = typeof e.data === 'string' ? strToU8(e.data) : e.data;
    tree[path] = [data, { level: STORED.has(extOf(path)) ? 0 : 6 }];
  }
  return zipSync(tree);
}

// Folder chosen with "Upload a folder": "MHH_HBRS_PhD_2027/01_Program_Info/a.pdf" → folder "01_Program_Info".
export function mapFolderUpload(fileList) {
  const list = [...fileList].filter(f => f.webkitRelativePath || f.name);
  const top = (list[0] && (list[0].webkitRelativePath || '').split('/')[0]) || '';
  const out = [];
  let readme = null, skipped = 0;
  for (const f of list) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    const rel = parts.slice(1);
    if (rel.some(isJunk)) { skipped++; continue; }
    const name = rel.pop();
    const folder = rel.map(cleanName).join('/');
    if (!folder && /^(\d+[\s._-]*)?readme\.(md|markdown|txt)$/i.test(name) && !readme) { readme = f; continue; }
    out.push({ file: f, folder, name: cleanName(name) });
  }
  return { top, files: out, readme, skipped };
}
