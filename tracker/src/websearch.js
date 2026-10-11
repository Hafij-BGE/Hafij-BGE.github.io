// "Search online" for Ask AI: free public research services, queried straight from the browser
// (no keys). The app collects and numbers the results; the AI answers from them and cites [n];
// the app itself shows the source list, so links are never invented.
export const WEB_SOURCES = {
  papers: { label: 'Papers', via: 'OpenAlex, Europe PMC' },
  data: { label: 'Datasets', via: 'DataCite (Zenodo, figshare, Dryad…), NCBI GEO' },
  wiki: { label: 'Wikipedia', via: 'Wikipedia' },
};
const STOP = new Set('a an and are as at be by can could did do does for from had has have how i in into is it its me my of on or our should so than that the their them then there these they this to was we were what when where which who why will with would you your about any some find search show tell give list latest recent new paper papers data dataset datasets study studies please online'.split(' '));
export function queryFrom(question) {
  const words = String(question || '').replace(/[“”"'’?!.,;:()[\]{}]/g, ' ').split(/\s+/).filter(Boolean);
  const keep = words.filter(w => !STOP.has(w.toLowerCase()) || /^[A-Z0-9-]{2,}$/.test(w));
  return (keep.length ? keep : words).slice(0, 12).join(' ');
}
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const cut = (s, n = 700) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);
const doiOf = d => String(d || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
const names = (list, n = 4) => (list.length > n ? list.slice(0, n).join(', ') + ', et al.' : list.join(', '));
async function getJSON(url, signal, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  const stop = () => ctl.abort();
  if (signal) signal.addEventListener('abort', stop);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', stop); }
}

async function openAlex(q, signal) {
  const d = await getJSON(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per_page=6&select=id,doi,display_name,publication_year,primary_location,authorships,cited_by_count,abstract_inverted_index`, signal);
  return (d.results || []).map(w => {
    let abs = '';
    if (w.abstract_inverted_index) {
      const pos = [];
      Object.entries(w.abstract_inverted_index).forEach(([word, idx]) => idx.forEach(i => { pos[i] = word; }));
      abs = pos.filter(Boolean).join(' ');
    }
    const doi = doiOf(w.doi);
    return {
      type: 'paper', source: 'OpenAlex', title: strip(w.display_name), year: w.publication_year || '',
      authors: names((w.authorships || []).map(a => a.author && a.author.display_name).filter(Boolean)),
      venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
      doi, url: doi ? `https://doi.org/${doi}` : w.id, cited: w.cited_by_count, snippet: cut(strip(abs)),
    };
  }).filter(r => r.title);
}
async function europePmc(q, signal) {
  const d = await getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=5&resultType=core`, signal);
  return ((d.resultList && d.resultList.result) || []).map(p => {
    const doi = doiOf(p.doi);
    return {
      type: 'paper', source: 'Europe PMC', title: strip(p.title), year: p.pubYear || '', authors: cut(strip(p.authorString), 120),
      venue: (p.journalInfo && p.journalInfo.journal && p.journalInfo.journal.title) || p.bookOrReportDetails?.publisher || (p.source === 'PPR' ? 'Preprint' : ''),
      doi, url: doi ? `https://doi.org/${doi}` : p.pmid ? `https://europepmc.org/article/MED/${p.pmid}` : `https://europepmc.org/search?query=${encodeURIComponent(p.id || '')}`,
      cited: p.citedByCount, snippet: cut(strip(p.abstractText)),
    };
  }).filter(r => r.title);
}
async function dataCite(q, signal) {
  const d = await getJSON(`https://api.datacite.org/dois?query=${encodeURIComponent(q)}&resource-type-id=dataset&page[size]=5`, signal);
  return (d.data || []).map(x => {
    const a = x.attributes || {};
    const pub = typeof a.publisher === 'string' ? a.publisher : (a.publisher && a.publisher.name) || '';
    return {
      type: 'dataset', source: 'DataCite', title: strip(((a.titles || [])[0] || {}).title), year: a.publicationYear || '',
      authors: names((a.creators || []).map(c => c.name).filter(Boolean), 3), venue: pub,
      doi: doiOf(a.doi), url: a.doi ? `https://doi.org/${a.doi}` : a.url, snippet: cut(strip(((a.descriptions || [])[0] || {}).description), 500),
    };
  }).filter(r => r.title);
}
async function geo(q, signal) {
  const s = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gds&term=${encodeURIComponent(q)}&retmax=4&retmode=json`, signal);
  const ids = (s.esearchresult && s.esearchresult.idlist) || [];
  if (!ids.length) return [];
  const d = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gds&id=${ids.join(',')}&retmode=json`, signal);
  const res = d.result || {};
  return (res.uids || ids).map(id => res[id]).filter(Boolean).map(g => ({
    type: 'dataset', source: 'NCBI GEO', title: strip(g.title), year: (g.pdat || '').slice(0, 4), authors: '',
    venue: [g.accession, g.taxon, g.n_samples ? `${g.n_samples} samples` : ''].filter(Boolean).join(' · '),
    accession: g.accession, url: g.accession ? `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${g.accession}` : 'https://www.ncbi.nlm.nih.gov/gds',
    snippet: cut(strip(g.summary), 500),
  })).filter(r => r.title);
}
async function wikipedia(q, signal) {
  const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=2&format=json&origin=*`, signal);
  const titles = ((s.query && s.query.search) || []).map(x => x.title);
  if (!titles.length) return [];
  const d = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exsentences=6&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`, signal);
  const pages = Object.values((d.query && d.query.pages) || {});
  return titles.map(t => pages.find(p => p.title === t)).filter(Boolean).map(p => ({
    type: 'wiki', source: 'Wikipedia', title: p.title, year: '', authors: '', venue: 'Wikipedia',
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, snippet: cut(strip(p.extract), 600),
  }));
}

// Runs the chosen services at the same time; any that fail are reported, the rest are used.
export async function searchOnline(question, kinds, signal) {
  const q = queryFrom(question);
  const jobs = [];
  if (kinds.includes('papers')) jobs.push(['OpenAlex', openAlex(q, signal)], ['Europe PMC', europePmc(q, signal)]);
  if (kinds.includes('data')) jobs.push(['DataCite', dataCite(q, signal)], ['NCBI GEO', geo(q, signal)]);
  if (kinds.includes('wiki')) jobs.push(['Wikipedia', wikipedia(q, signal)]);
  const settled = await Promise.allSettled(jobs.map(j => j[1]));
  const errors = [], all = [];
  settled.forEach((s, i) => { if (s.status === 'fulfilled') all.push(...s.value); else errors.push(jobs[i][0]); });
  // One entry per paper/dataset (same DOI or same title), papers first, at most 14.
  const seen = new Set(), out = [];
  const key = r => r.doi || r.accession || r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const r of all) { const k = key(r); if (seen.has(k)) continue; seen.add(k); out.push(r); }
  const order = { paper: 0, dataset: 1, wiki: 2 };
  out.sort((a, b) => order[a.type] - order[b.type]);
  return { query: q, results: out.slice(0, 14), errors };
}
export function webText(results) {
  return results.map((r, i) => `[${i + 1}] ${r.type === 'dataset' ? 'DATASET' : r.type === 'wiki' ? 'ENCYCLOPEDIA' : 'PAPER'}: ${r.title}`
    + `${r.year ? ` (${r.year})` : ''}${r.authors ? `. ${r.authors}` : ''}${r.venue ? `. ${r.venue}` : ''}${r.cited != null ? `. Cited ${r.cited}×` : ''}`
    + `. ${r.doi ? 'https://doi.org/' + r.doi : r.url}${r.snippet ? `\n    ${r.snippet}` : ''}`).join('\n');
}
