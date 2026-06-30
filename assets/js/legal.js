'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   LEGAL — fetch markdown from Supabase Storage and render flat prose page.
   Always requests the live file (no browser cache). On network failure only,
   falls back to the last successfully loaded copy in localStorage.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const LEGAL_CONTENT_URL = 'https://mmdmibimpipxckgfmhmz.supabase.co/storage/v1/object/public/User-Facing Data/legal.md';
  const LEGAL_CACHE_KEY = 'gm_legal_md:' + LEGAL_CONTENT_URL;

  const root = document.getElementById('legalContent');
  if (!root) return;

  const MD = window.FaqMarkdown;
  if (!MD || !MD.parseLegal) {
    root.innerHTML = '<div class="faq-error panel faq-rise"><p><strong>Could not load legal document</strong></p><p>Parser unavailable.</p></div>';
    return;
  }

  function renderPage(data, opts) {
    const fromCache = opts && opts.fromCache;
    const rendered = MD.renderLegalDocumentHtml(data);

    root.innerHTML =
      (fromCache
        ? '<p class="faq-cache-notice faq-rise" role="status">Showing a saved copy — live document is temporarily unavailable.</p>'
        : '') +
      '<section class="faq-hero">' +
        '<div class="faq-beat-row live faq-rise d1" aria-hidden="true">' +
          '<div class="faq-hex accent"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
        '</div>' +
        '<p class="faq-eyebrow faq-rise d1">Policies</p>' +
        '<h1 class="faq-title faq-rise d2">' + MD.escapeHtml(data.title) + '</h1>' +
        (data.intro
          ? '<p class="faq-lede faq-rise d3">' + MD.inlineMdRich(data.intro) + '</p>'
          : '') +
      '</section>' +
      rendered.metaHtml +
      rendered.sectionsHtml +
      rendered.footerHtml +
      '<div class="faq-cta faq-rise d3">' +
        '<a class="faq-btn-gold" href="index.html">Back to App</a>' +
      '</div>';
  }

  function renderError(message) {
    root.innerHTML =
      '<div class="faq-error panel faq-rise">' +
        '<p><strong>Could not load legal document</strong></p>' +
        '<p>' + MD.escapeHtml(message) + '</p>' +
      '</div>';
  }

  function readCache() {
    try {
      return localStorage.getItem(LEGAL_CACHE_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeCache(md) {
    try {
      localStorage.setItem(LEGAL_CACHE_KEY, md);
    } catch (e) { /* private mode / quota */ }
  }

  function fetchLiveMd() {
    const bust = (LEGAL_CONTENT_URL.includes('?') ? '&' : '?') + '_=' + Date.now();
    return fetch(LEGAL_CONTENT_URL + bust, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function loadLegal() {
    fetchLiveMd()
      .then((md) => {
        writeCache(md);
        renderPage(MD.parseLegal(md));
      })
      .catch((err) => {
        const cached = readCache();
        if (cached) {
          renderPage(MD.parseLegal(cached), { fromCache: true });
          return;
        }
        renderError(err.message || String(err));
      });
  }

  loadLegal();
})();
