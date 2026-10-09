// Links and references for a research article: link types, DOI lookup (Crossref),
// BibTeX / RIS import and export, formatted reference text, data availability statement.

export const LINK_TYPES = [
  ['github', 'GitHub / code'], ['dataset', 'Dataset'], ['accession', 'Database accession'], ['preprint', 'Preprint'],
  ['journal', 'Journal article'], ['supplement', 'Supplementary'], ['protocol', 'Protocol'], ['tool', 'Software / tool'], ['other', 'Other'],
];
export const linkTypeLabel = t => (LINK_TYPES.find(x => x[0] === t) || LINK_TYPES[LINK_TYPES.length - 1])[1];

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>{}]+[^\s"<>{}.,;)\]])/i;
export const findDoi = s => { const m = DOI_RE.exec(String(s || '')); return m ? m[1] : ''; };
export const cleanDoi = s => findDoi(decodeURIComponent(String(s || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''))) || '';

// Recognise what a link points to from its address.
export function guessLink(url) {
  const u = String(url || '').trim().toLowerCase();
  if (/github\.com|gitlab\.com|bitbucket\.org/.test(u)) return 'github';
  if (/zenodo|figshare|osf\.io|datadryad|data\.mendeley|dataverse|kaggle\.com\/datasets/.test(u)) return 'dataset';
  if (/ncbi\.nlm\.nih\.gov\/(geo|sra|bioproject|biosample|nuccore)|ebi\.ac\.uk\/(pride|ena|arrayexpress|biostudies)|proteomexchange|massive\.ucsd|rcsb\.org|\bpdb\b|uniprot\.org|^(gse|gsm|prjna|srr|pxd|e-mtab)\d/i.test(u)) return 'accession';
  if (/biorxiv|medrxiv|arxiv\.org|researchsquare|preprints\.org|ssrn/.test(u)) return 'preprint';
  if (/protocols\.io|bio-protocol/.test(u)) return 'protocol';
  if (/supplement|suppl|\/si\b/.test(u)) return 'supplement';
  if (/doi\.org\/10\.|^10\.\d/.test(u)) return 'journal';
  return 'other';
}
// Accession numbers typed without a web address become links.
export function linkHref(v) {
  const s = String(v || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^10\.\d/.test(s)) return 'https://doi.org/' + s;
  let m;
  if ((m = /^(GSE|GSM)\d+$/i.exec(s))) return `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${s.toUpperCase()}`;
  if ((m = /^PXD\d+$/i.exec(s))) return `https://www.ebi.ac.uk/pride/archive/projects/${s.toUpperCase()}`;
  if ((m = /^(PRJNA|PRJEB|SRR|SRP|SRX|ERR)\d+$/i.exec(s))) return `https://www.ncbi.nlm.nih.gov/search/all/?term=${s.toUpperCase()}`;
  if ((m = /^\d[A-Za-z0-9]{3}$/.exec(s))) return `https://www.rcsb.org/structure/${s.toUpperCase()}`;
  return '';
}

/* ---------- reference text ---------- */
const authorList = r => {
  const a = (r.authors || '').split(/\s*;\s*|\s+and\s+/).filter(Boolean);
  if (a.length > 6) return a.slice(0, 6).join(', ') + ', et al.';
  return a.join(', ');
};
export function formatRef(r) {
  if (!r.title) return r.text || r.doi || '';
  const vol = [r.volume, r.issue && `(${r.issue})`].filter(Boolean).join('');
  const where = [r.journal, [vol, r.pages].filter(Boolean).join(':')].filter(Boolean).join(', ');
  return [authorList(r), r.year && `(${r.year})`, r.title.replace(/\.$/, '') + '.', where && where + '.', r.doi ? `https://doi.org/${r.doi}` : r.url || '']
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const sameRef = (a, b) => (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase()) || (norm(a.title || a.text).length > 12 && norm(a.title || a.text) === norm(b.title || b.text));

/* ---------- DOI lookup (Crossref, free and public) ---------- */
export async function lookupDoi(doi) {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error(`DOI not found: ${doi}`);
  if (!res.ok) throw new Error('Crossref is not answering right now.');
  const m = (await res.json()).message || {};
  const year = ((m.issued || m['published-print'] || m['published-online'] || {})['date-parts'] || [[]])[0][0];
  return {
    doi: (m.DOI || doi).toLowerCase(), title: (m.title || [])[0] || '', journal: (m['container-title'] || [])[0] || m.publisher || '',
    authors: (m.author || []).map(a => [a.family, a.given ? a.given.split(/[\s-]+/).map(x => x[0]).join('') : ''].filter(Boolean).join(' ') || a.name).filter(Boolean).join('; '),
    year: year || '', volume: m.volume || '', issue: m.issue || '', pages: m.page || m['article-number'] || '', url: m.URL || '',
  };
}

// "Md. Hafijur" → "MH"; "MH" or "M.H." stays "MH".
const initials = g => {
  const t = String(g || '').trim();
  if (!t) return '';
  if (!/[a-z]/.test(t)) return t.replace(/[^A-Z]/g, '');
  return t.split(/[\s.-]+/).filter(Boolean).map(x => x[0].toUpperCase()).join('');
};

/* ---------- BibTeX ---------- */
function bibFields(body) {
  const out = {};
  let i = 0;
  while (i < body.length) {
    const m = /\s*([A-Za-z][\w-]*)\s*=\s*/y; m.lastIndex = i;
    const k = m.exec(body); if (!k) { i++; continue; }
    i = m.lastIndex;
    let v = '';
    if (body[i] === '{') { let d = 0; const s = i; for (; i < body.length; i++) { if (body[i] === '{') d++; else if (body[i] === '}' && --d === 0) break; } v = body.slice(s + 1, i); i++; }
    else if (body[i] === '"') { const s = ++i; while (i < body.length && body[i] !== '"') i++; v = body.slice(s, i); i++; }
    else { const s = i; while (i < body.length && body[i] !== ',') i++; v = body.slice(s, i).trim(); }
    out[k[1].toLowerCase()] = v.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    while (i < body.length && body[i] !== ',') i++;
    i++;
  }
  return out;
}
export function parseBib(text) {
  const refs = [];
  const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue;
    let d = 1, i = re.lastIndex;
    for (; i < text.length && d; i++) { if (text[i] === '{') d++; else if (text[i] === '}') d--; }
    const f = bibFields(text.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
    refs.push({
      title: f.title || '', journal: f.journal || f.booktitle || f.publisher || f.howpublished || '', year: f.year || '',
      authors: (f.author || '').split(/\s+and\s+/i).map(a => { const [fam, giv] = a.includes(',') ? a.split(/\s*,\s*/) : [a.split(' ').pop(), a.split(' ').slice(0, -1).join(' ')]; return [fam, initials(giv)].filter(Boolean).join(' '); }).filter(Boolean).join('; '),
      volume: f.volume || '', issue: f.number || '', pages: (f.pages || '').replace(/--/g, '–'), doi: cleanDoi(f.doi || ''), url: f.url || '',
    });
  }
  return refs.filter(r => r.title || r.doi);
}
const bibKey = (r, used) => {
  const base = ((r.authors || '').split(/[;\s]/)[0] || 'ref').replace(/[^A-Za-z]/g, '') + (r.year || '') + (norm(r.title).split(' ').find(w => w.length > 3) || '');
  let k = base || 'ref', n = 1; while (used.has(k)) k = base + String.fromCharCode(97 + n++); used.add(k); return k;
};
const bibEsc = s => String(s || '').replace(/[{}]/g, '');
export function toBib(refs) {
  const used = new Set();
  return refs.map(r => {
    const f = r.title ? [
      ['author', (r.authors || '').split(/\s*;\s*/).filter(Boolean).map(a => { const p = a.split(' '); return p.length > 1 ? `${p.slice(0, -1).join(' ')}, ${p[p.length - 1]}` : a; }).join(' and ')],
      ['title', `{${bibEsc(r.title)}}`], ['journal', r.journal], ['year', r.year], ['volume', r.volume], ['number', r.issue], ['pages', String(r.pages || '').replace(/–/g, '--')], ['doi', r.doi], ['url', !r.doi && r.url],
    ] : [['note', r.text], ['doi', r.doi]];
    return `@${r.title ? 'article' : 'misc'}{${bibKey(r, used)},\n${f.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${bibEsc(v)}}`).join(',\n')}\n}`;
  }).join('\n\n') + '\n';
}

/* ---------- RIS ---------- */
export function parseRis(text) {
  const refs = []; let cur = null;
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    const m = /^([A-Z][A-Z0-9])  -\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, v] = m;
    if (tag === 'TY') { cur = { title: '', authors: [], journal: '', year: '', volume: '', issue: '', pages: '', doi: '', url: '' }; continue; }
    if (!cur) continue;
    if (tag === 'ER') { refs.push({ ...cur, authors: cur.authors.join('; '), pages: cur.ep ? `${cur.pages}–${cur.ep}` : cur.pages }); cur = null; continue; }
    if (['TI', 'T1'].includes(tag)) cur.title = cur.title || v;
    else if (['AU', 'A1'].includes(tag)) { const [fam, giv] = v.split(/\s*,\s*/); cur.authors.push([fam, initials(giv)].filter(Boolean).join(' ')); }
    else if (['JO', 'JF', 'T2', 'JA'].includes(tag)) cur.journal = cur.journal || v;
    else if (['PY', 'Y1', 'DA'].includes(tag)) cur.year = cur.year || (/(\d{4})/.exec(v) || [])[1] || '';
    else if (tag === 'VL') cur.volume = v; else if (tag === 'IS') cur.issue = v;
    else if (tag === 'SP') cur.pages = v; else if (tag === 'EP') cur.ep = v;
    else if (tag === 'DO') cur.doi = cleanDoi(v); else if (tag === 'UR') cur.url = cur.url || v;
  }
  return refs.filter(r => r.title || r.doi).map(({ ep, ...r }) => r);
}
export function toRis(refs) {
  return refs.map(r => {
    const L = [['TY', r.title ? 'JOUR' : 'GEN']];
    (r.authors || '').split(/\s*;\s*/).filter(Boolean).forEach(a => { const p = a.split(' '); L.push(['AU', p.length > 1 ? `${p.slice(0, -1).join(' ')}, ${p[p.length - 1]}` : a]); });
    if (r.title) L.push(['TI', r.title]); else if (r.text) L.push(['TI', r.text]);
    if (r.journal) L.push(['JO', r.journal]); if (r.year) L.push(['PY', r.year]);
    if (r.volume) L.push(['VL', r.volume]); if (r.issue) L.push(['IS', r.issue]);
    if (r.pages) { const [sp, ep] = String(r.pages).split(/[–-]/); L.push(['SP', sp]); if (ep) L.push(['EP', ep]); }
    if (r.doi) L.push(['DO', r.doi]); if (r.url && !r.doi) L.push(['UR', r.url]);
    L.push(['ER', '']);
    return L.map(([k, v]) => `${k}  - ${v}`).join('\n');
  }).join('\n\n') + '\n';
}

// Pasted list: one reference per line (or per blank-line-separated block); numbering is removed.
export function parsePasted(text) {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (!t) return [];
  if (/^\s*@\w+\s*\{/m.test(t)) return parseBib(t);
  if (/^TY  -/m.test(t)) return parseRis(t);
  const blocks = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n');
  return blocks.map(b => b.replace(/\s*\n\s*/g, ' ').replace(/^\s*(\[\d+\]|\d+[.)])\s*/, '').trim()).filter(b => b.length > 8)
    .map(b => ({ text: b, doi: findDoi(b) }));
}

// "Data availability" paragraph built from the article's links.
export function dataStatement(links) {
  const by = t => links.filter(l => l.type === t);
  const item = l => `${l.label ? l.label + ' ' : ''}(${linkHref(l.url) || l.url})`;
  const parts = [];
  const data = by('dataset').concat(by('accession'));
  if (data.length) parts.push(`The data supporting the findings of this study are openly available: ${data.map(item).join('; ')}.`);
  if (by('github').length || by('tool').length) parts.push(`The code used for the analyses is available at ${by('github').concat(by('tool')).map(item).join('; ')}.`);
  if (by('protocol').length) parts.push(`Protocols: ${by('protocol').map(item).join('; ')}.`);
  if (by('supplement').length) parts.push(`Supplementary material: ${by('supplement').map(item).join('; ')}.`);
  return parts.join(' ') || 'All data supporting the findings of this study are available within the article and its supplementary information.';
}
