// Public GitHub activity for the owner's repositories (no sign-in, no token; cached for 30 minutes).
export const GH_USER = 'Hafij-BGE';
let mem = null, inflight = null;
export function cachedRepos() {
  if (mem) return mem;
  try { const c = JSON.parse(localStorage.getItem('rl.gh') || 'null'); if (c && c.repos) mem = c; } catch (e) {}
  return mem;
}
export async function loadRepos(force) {
  const c = cachedRepos();
  if (!force && c && Date.now() - c.at < 30 * 60 * 1000) return c.repos;
  if (inflight) return inflight;
  inflight = fetch(`https://api.github.com/users/${GH_USER}/repos?per_page=100&sort=pushed`, { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('GitHub ' + r.status))))
    .then(list => {
      const repos = list.filter(r => !r.fork).map(r => ({
        name: r.name, url: r.html_url, description: r.description || '', language: r.language || '', pushed: r.pushed_at, stars: r.stargazers_count || 0,
      }));
      mem = { at: Date.now(), repos };
      try { localStorage.setItem('rl.gh', JSON.stringify(mem)); } catch (e) {}
      return repos;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
// "https://github.com/Hafij-BGE/sh3-mechanism" anywhere in a project's links → that repository.
export function repoFor(x, repos) {
  const text = [x.links, x.description, x.source].filter(Boolean).join(' ');
  const re = new RegExp(`github\\.com/${GH_USER}/([A-Za-z0-9_.-]+)`, 'gi');
  let m;
  while ((m = re.exec(text))) { const n = m[1].replace(/\.git$/, '').toLowerCase(); const r = (repos || []).find(r => r.name.toLowerCase() === n); if (r) return r; }
  return null;
}
export function ago(iso) {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 45) return `${Math.round(d / 86400)} d ago`;
  if (d < 86400 * 400) return `${Math.round(d / 86400 / 30)} mo ago`;
  return `${(d / 86400 / 365).toFixed(1)} y ago`;
}
