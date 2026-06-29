'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PATCH NOTES — fetch versioned markdown from Supabase Storage; latest release
   expanded, older releases collapsed (lazy-loaded). Marks seen on successful load.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const root = document.getElementById('patchNotesContent');
  if (!root) return;

  const MD = window.FaqMarkdown;
  const Store = window.PatchNotesStorage;
  const CACHE_MD_PREFIX = 'gm_patch_notes_md:';
  const CACHE_MD_MAX = 5;

  if (!MD || !Store) {
    root.innerHTML = '<div class="faq-error panel faq-rise"><p><strong>Could not load patch notes</strong></p><p>Required scripts unavailable.</p></div>';
    return;
  }

  function readMdCache(version) {
    try {
      return localStorage.getItem(CACHE_MD_PREFIX + version);
    } catch (e) {
      return null;
    }
  }

  function pruneMdCache() {
    try {
      const versions = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(CACHE_MD_PREFIX)) continue;
        versions.push(key.slice(CACHE_MD_PREFIX.length));
      }
      versions.sort((a, b) => Store.compareSemver(b, a));
      for (let i = CACHE_MD_MAX; i < versions.length; i++) {
        localStorage.removeItem(CACHE_MD_PREFIX + versions[i]);
      }
    } catch (e) { /* private mode / quota */ }
  }

  function writeMdCache(version, md) {
    try {
      localStorage.setItem(CACHE_MD_PREFIX + version, md);
      pruneMdCache();
    } catch (e) { /* skip */ }
  }

  function summaryFromLede(lede) {
    if (!lede) return '';
    const plain = lede.replace(/\*\*/g, '').trim();
    const first = plain.split(/\n/)[0].trim();
    return first.length > 120 ? first.slice(0, 117) + '…' : first;
  }

  function isoFromUpdatedAt(updatedAt) {
    if (!updatedAt) return null;
    const d = new Date(updatedAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  function resolveReleaseDate(parsed, entry) {
    if (parsed && parsed.releasedDate) return parsed.releasedDate;
    return isoFromUpdatedAt(entry && entry.updated_at);
  }

  function formatReleaseLabel(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function renderReleaseDateHtml(isoDate) {
    const label = formatReleaseLabel(isoDate);
    if (!label) return '';
    return (
      '<p class="patch-release-date faq-rise d3">' +
        '<time datetime="' + MD.escapeHtml(isoDate) + '">' + MD.escapeHtml(label) + '</time>' +
      '</p>'
    );
  }

  function buildOlderSummary(entry, cachedMd) {
    const parsed = cachedMd ? MD.parse(cachedMd) : null;
    return parsed ? summaryFromLede(parsed.lede) : '';
  }

  function renderOlderEntry(entry) {
    const cached = readMdCache(entry.version);
    const parsed = cached ? MD.parse(cached) : null;
    const releaseIso = resolveReleaseDate(parsed, entry);
    const dateLabel = formatReleaseLabel(releaseIso);
    const ledePart = buildOlderSummary(entry, cached);
    return (
      '<details class="patch-version faq-rise panel">' +
        '<summary class="patch-version-summary">' +
          '<span class="patch-version-heading">v' + MD.escapeHtml(entry.version) + '</span>' +
          (dateLabel
            ? '<time class="patch-version-date" datetime="' + MD.escapeHtml(releaseIso) + '">' +
                MD.escapeHtml(dateLabel) + '</time>'
            : '') +
          (ledePart
            ? '<span class="patch-version-lede">' + MD.escapeHtml(ledePart) + '</span>'
            : '') +
        '</summary>' +
        '<div class="patch-version-body" data-version="' + MD.escapeHtml(entry.version) + '">' +
          '<p class="patch-version-loading">Loading…</p>' +
        '</div>' +
      '</details>'
    );
  }

  function renderEmpty() {
    root.innerHTML =
      '<section class="faq-hero">' +
        '<div class="faq-beat-row live faq-rise d1" aria-hidden="true">' +
          '<div class="faq-hex accent"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
        '</div>' +
        '<p class="faq-eyebrow faq-rise d1">What\'s New</p>' +
        '<h1 class="faq-title faq-rise d2">Patch Notes</h1>' +
      '</section>' +
      '<div class="faq-error panel faq-rise">' +
        '<p><strong>No patch notes yet</strong></p>' +
        '<p>Check back after the next update.</p>' +
      '</div>' +
      '<div class="faq-cta faq-rise d3">' +
        '<a class="faq-btn-gold" href="index.html">Back to App</a>' +
      '</div>';
  }

  function renderError(message, fromCache) {
    root.innerHTML =
      (fromCache
        ? '<p class="faq-cache-notice faq-rise" role="status">Showing a saved copy — live patch notes are temporarily unavailable.</p>'
        : '') +
      '<div class="faq-error panel faq-rise">' +
        '<p><strong>Could not load patch notes</strong></p>' +
        '<p>' + MD.escapeHtml(message) + '</p>' +
      '</div>' +
      '<div class="faq-cta faq-rise d3">' +
        '<a class="faq-btn-gold" href="index.html">Back to App</a>' +
      '</div>';
  }

  function renderHero(version, parsed, entry) {
    const releaseIso = resolveReleaseDate(parsed, entry);
    return (
      '<section class="faq-hero">' +
        '<div class="faq-beat-row live faq-rise d1" aria-hidden="true">' +
          '<div class="faq-hex accent"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
        '</div>' +
        '<p class="faq-eyebrow faq-rise d1">What\'s New</p>' +
        '<h1 class="faq-title faq-rise d2">v' + MD.escapeHtml(version) + '</h1>' +
        renderReleaseDateHtml(releaseIso) +
        (parsed.lede ? '<p class="faq-lede faq-rise d3">' + MD.inlineMd(parsed.lede) + '</p>' : '') +
      '</section>'
    );
  }

  function wireOlderLazyLoad() {
    root.querySelectorAll('.patch-version').forEach((details) => {
      details.addEventListener('toggle', function onToggle() {
        if (!details.open) return;
        const body = details.querySelector('.patch-version-body');
        if (!body || body.dataset.loaded === '1') return;
        const version = body.getAttribute('data-version');
        if (!version) return;

        Store.fetchPatchNote(version)
          .then((md) => {
            writeMdCache(version, md);
            const parsed = MD.parse(md);
            body.innerHTML = MD.renderPatchSectionsHtml(parsed.sections);
            body.dataset.loaded = '1';
          })
          .catch(() => {
            const cached = readMdCache(version);
            if (cached) {
              body.innerHTML = MD.renderPatchSectionsHtml(MD.parse(cached).sections);
              body.dataset.loaded = '1';
              return;
            }
            body.innerHTML = '<p class="patch-version-loading">Could not load this release.</p>';
          });
      });
    });
  }

  function renderPage(entries, latestMd, opts) {
    const fromCache = opts && opts.fromCache;
    const latest = entries[0];
    const parsed = MD.parse(latestMd);
    const older = entries.slice(1);

    let html =
      (fromCache
        ? '<p class="faq-cache-notice faq-rise" role="status">Showing a saved copy — live patch notes are temporarily unavailable.</p>'
        : '') +
      renderHero(latest.version, parsed, latest) +
      MD.renderPatchSectionsHtml(parsed.sections);

    if (older.length) {
      html += '<div class="patch-history faq-rise d2">';
      html += '<h2 class="patch-history-title">Previous releases</h2>';
      older.forEach((entry) => {
        html += renderOlderEntry(entry);
      });
      html += '</div>';
    }

    html +=
      '<div class="faq-cta faq-rise d3">' +
        '<a class="faq-btn-gold" href="index.html">Back to App</a>' +
      '</div>';

    root.innerHTML = html;
    wireOlderLazyLoad();
    Store.markSeen(latest.version);
  }

  function loadFromCache(entries) {
    const latest = entries[0];
    const cached = readMdCache(latest.version);
    if (!cached) return false;
    renderPage(entries, cached, { fromCache: true });
    return true;
  }

  function load() {
    Store.listPatchNotes()
      .then((entries) => {
        if (!entries.length) {
          const cachedList = Store.readListCache();
          if (cachedList && cachedList.length && loadFromCache(cachedList)) return;
          renderEmpty();
          return;
        }

        const latest = entries[0];
        return Store.fetchPatchNote(latest.version)
          .then((md) => {
            writeMdCache(latest.version, md);
            renderPage(entries, md);
          });
      })
      .catch((err) => {
        const cachedList = Store.readListCache();
        if (cachedList && cachedList.length && loadFromCache(cachedList)) return;
        renderError(err.message || String(err));
      });
  }

  load();
})();
