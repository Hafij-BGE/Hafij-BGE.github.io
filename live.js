// Keeps parts of this website up to date by itself:
//  · "Latest on GitHub" — the most recently updated public repositories (GitHub's public API)
//  · publications, presentations, awards and current projects that the owner marks public in his
//    Research Log (read from a public feed that only holds what he chose to publish)
// The hand-written content always stays; live data only adds to it. If anything can't load, the page is unchanged.
(function () {
  'use strict';
  var FEED = 'https://firestore.googleapis.com/v1/projects/research-log-bd8a2/databases/(default)/documents/public/site?key=AIzaSyBtqpOK9PPcvqDuDTHK58OX7YKiwJhplMo';
  var GH = 'Hafij-BGE';
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  if (!$$('[data-live]').length) return;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function cached(name, maxAgeMin, load) {
    try { var c = JSON.parse(sessionStorage.getItem('live.' + name) || 'null'); if (c && Date.now() - c.at < maxAgeMin * 60000) return Promise.resolve(c.v); } catch (e) {}
    return load().then(function (v) { try { sessionStorage.setItem('live.' + name, JSON.stringify({ at: Date.now(), v: v })); } catch (e) {} return v; });
  }
  function ago(iso) {
    var d = (Date.now() - new Date(iso)) / 864e5;
    if (d < 1) return 'today'; if (d < 2) return 'yesterday'; if (d < 45) return Math.round(d) + ' days ago';
    if (d < 400) return Math.round(d / 30) + ' months ago'; return (d / 365).toFixed(1) + ' years ago';
  }
  var words = function (s) {
    return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u0131/g, 'i').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (w) { return w.length > 3; });
  };
  // Same item already on the page? Same DOI, or most of the shorter title's words appear in the other.
  function onPage(list, title, doi) {
    return $$('li', list).some(function (li) {
      var html = li.innerHTML.toLowerCase();
      if (doi && html.indexOf(String(doi).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')) >= 0) return true;
      var a = words(title), b = words((li.querySelector('.t') || li.querySelector('div') || li).textContent);
      if (!a.length || !b.length) return false;
      var short = a.length <= b.length ? a : b, long = a.length <= b.length ? b : a;
      var hit = short.filter(function (w) { return long.indexOf(w) >= 0; }).length;
      return hit / short.length >= 0.7;
    });
  }
  function yearOf(li) { var m = /(\d{4})/.exec((li.querySelector('.yr') || {}).textContent || ''); return m ? +m[1] : 0; }
  function addSorted(list, html) {
    list.insertAdjacentHTML('beforeend', html);
    $$('li', list).sort(function (a, b) { return yearOf(b) - yearOf(a); }).forEach(function (li) { list.appendChild(li); });
  }
  var doiLink = function (v) { if (!v) return ''; var u = /^10\.\d/.test(v) ? 'https://doi.org/' + v : v; return /^https?:\/\//.test(u) ? '<a href="' + esc(u) + '">' + esc(u.replace(/^https?:\/\//, '')) + '</a>' : ''; };
  function show(name) { $$('[data-live-wrap="' + name + '"]').forEach(function (w) { w.hidden = false; }); }

  /* ---- GitHub ---- */
  var repos = cached('repos', 30, function () {
    return fetch('https://api.github.com/users/' + GH + '/repos?per_page=100&sort=pushed').then(function (r) { if (!r.ok) throw r.status; return r.json(); })
      .then(function (l) { return l.filter(function (r) { return !r.fork && r.name.toLowerCase() !== GH.toLowerCase() && !/\.github\.io$/i.test(r.name); })
        .map(function (r) { return { name: r.name, url: r.html_url, description: r.description || '', language: r.language || '', pushed: r.pushed_at, stars: r.stargazers_count || 0 }; }); });
  }).catch(function () { return null; });

  repos.then(function (list) {
    if (!list || !list.length) return;
    $$('[data-live="repos"]').forEach(function (box) {
      box.innerHTML = list.slice(0, +(box.getAttribute('data-count') || 4)).map(function (r) {
        return '<article class="card"><h3><a href="' + esc(r.url) + '">' + esc(r.name) + '</a></h3>' +
          '<p class="meta">' + [r.language, 'updated ' + ago(r.pushed), r.stars ? '★ ' + r.stars : ''].filter(Boolean).map(esc).join(' · ') + '</p>' +
          (r.description ? '<p>' + esc(r.description) + '</p>' : '') + '</article>';
      }).join('');
      show('repos');
    });
  });

  /* ---- Research Log feed ---- */
  cached('feed', 5, function () {
    return fetch(FEED, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw r.status; return r.json(); })
      .then(function (d) { return JSON.parse(d.fields.json.stringValue); });
  }).then(function (feed) {
    if (!feed || feed.off || !feed.items) return;
    var of = function (k) { return feed.items.filter(function (x) { return x.kind === k; }); };
    var published = of('publication').filter(function (p) { return p.status === 'Published' || p.status === 'Accepted'; });

    $$('[data-live="papers-count"]').forEach(function (el) {
      var n = published.filter(function (p) { return p.status === 'Published'; }).length;
      if (n > (+el.textContent || 0)) el.textContent = n;
    });
    $$('[data-live="articles"]').forEach(function (list) {
      published.forEach(function (p) {
        if (onPage(list, p.title, p.doi)) return;
        var meta = [p.authors, p.venue, p.status === 'Accepted' ? 'accepted, in press' : ''].filter(Boolean).map(esc).join(' · ');
        addSorted(list, '<li class="live-new"><span class="yr">' + esc(p.year || '') + '</span><div><span class="t">' + esc(p.title) + '</span>' +
          ((meta || p.doi) ? '<p class="meta">' + [meta, doiLink(p.doi)].filter(Boolean).join(' · ') + '</p>' : '') + '</div></li>');
      });
    });
    if (feed.inProgress) $$('[data-live="inprogress"]').forEach(function (list) {
      var wip = of('publication').filter(function (p) { return ['Drafting', 'Submitted', 'Under review', 'Revision'].indexOf(p.status) >= 0; });
      if (!wip.length) return;
      list.innerHTML = wip.map(function (p) { return '<li><span class="yr">' + esc(p.status) + '</span><div><span class="t">' + esc(p.title) + '</span></div></li>'; }).join('');
      show('inprogress');
    });
    $$('[data-live="talks"]').forEach(function (list) {
      of('talk').forEach(function (t) {
        if (onPage(list, t.title)) return;
        var meta = [t.type, [t.event, t.location].filter(Boolean).join(', '), t.coauthors && 'with ' + t.coauthors].filter(Boolean).map(esc).join(' · ');
        addSorted(list, '<li class="live-new"><span class="yr">' + esc((t.date || '').slice(0, 4)) + '</span><div><span class="t">' + esc(t.title) + '</span>' + (meta ? '<p class="meta">' + meta + '</p>' : '') + '</div></li>');
      });
    });
    $$('[data-live="awards"]').forEach(function (list) {
      of('award').forEach(function (a) {
        if (onPage(list, a.title)) return;
        addSorted(list, '<li class="live-new"><span class="yr">' + esc(a.year || '') + '</span><div>' + esc(a.title) + (a.issuer ? ', ' + esc(a.issuer) : '') + '</div></li>');
      });
    });
    var active = of('project').filter(function (p) { return p.status === 'Active'; })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    if (active.length) repos.then(function (list) {
      $$('[data-live="projects"]').forEach(function (box) {
        box.innerHTML = active.slice(0, +(box.getAttribute('data-count') || 4)).map(function (p) {
          var m = /github\.com\/[^\/\s]+\/([A-Za-z0-9_.-]+)/i.exec(p.links || '');
          var repo = m && (list || []).filter(function (r) { return r.name.toLowerCase() === m[1].toLowerCase(); })[0];
          var link = repo ? repo.url : (/^https?:\/\/\S+$/.test((p.links || '').trim()) ? p.links.trim() : '');
          var desc = (p.description || '').length > 220 ? p.description.slice(0, 217).replace(/\s+\S*$/, '') + '…' : (p.description || '');
          return '<article class="card"><h3>' + (link ? '<a href="' + esc(link) + '">' + esc(p.title) + '</a>' : esc(p.title)) + '</h3>' +
            '<p class="meta">' + [p.area, repo && 'code updated ' + ago(repo.pushed)].filter(Boolean).map(esc).join(' · ') + '</p>' +
            (p.progress != null ? '<div class="live-bar" role="img" aria-label="' + (+p.progress || 0) + '% done"><i style="width:' + Math.min(100, +p.progress || 0) + '%"></i></div><p class="meta small">' + (+p.progress || 0) + '% done</p>' : '') +
            (desc ? '<p>' + esc(desc) + '</p>' : '') + '</article>';
        }).join('');
        show('projects');
      });
    });
  }).catch(function () {});
})();
