'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   FAQ — fetch markdown content and render styled accordion page.
   Always requests the live file (no browser cache). On network failure only,
   falls back to the last successfully loaded copy in localStorage.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const FAQ_CONTENT_URL = 'https://mmdmibimpipxckgfmhmz.supabase.co/storage/v1/object/public/User-Facing Data/FAQ.md';
  const FAQ_CACHE_KEY = 'gm_faq_md:' + FAQ_CONTENT_URL;

  const root = document.getElementById('faqContent');
  if (!root) return;

  const MD = window.FaqMarkdown;
  if (!MD) {
    root.innerHTML = '<div class="faq-error panel faq-rise"><p><strong>Could not load FAQ</strong></p><p>Parser unavailable.</p></div>';
    return;
  }

  function renderPage(data, opts) {
    const fromCache = opts && opts.fromCache;
    const sectionHtml = MD.renderSectionsHtml(data.sections);

    root.innerHTML =
      (fromCache
        ? '<p class="faq-cache-notice faq-rise" role="status">Showing a saved copy — live FAQ is temporarily unavailable.</p>'
        : '') +
      '<section class="faq-hero">' +
        '<div class="faq-beat-row live faq-rise d1" aria-hidden="true">' +
          '<div class="faq-hex accent"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
        '</div>' +
        '<p class="faq-eyebrow faq-rise d1">Help &amp; Support</p>' +
        '<h1 class="faq-title faq-rise d2">' + MD.escapeHtml(data.title) + '</h1>' +
        (data.lede ? '<p class="faq-lede faq-rise d3">' + MD.inlineMd(data.lede) + '</p>' : '') +
      '</section>' +
      sectionHtml +
      '<div class="faq-cta faq-rise d3">' +
        '<p class="faq-tutorial-link"><a href="tutorial.html">Watch the tutorial video</a></p>' +
        '<p class="faq-cta-line">Still stuck? Send us a note from Settings.</p>' +
        '<a class="faq-btn-gold" href="index.html">Back to App</a>' +
      '</div>';
  }

  function renderError(message) {
    root.innerHTML =
      '<div class="faq-error panel faq-rise">' +
        '<p><strong>Could not load FAQ</strong></p>' +
        '<p>' + MD.escapeHtml(message) + '</p>' +
      '</div>';
  }

  function readCache() {
    try {
      return localStorage.getItem(FAQ_CACHE_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeCache(md) {
    try {
      localStorage.setItem(FAQ_CACHE_KEY, md);
    } catch (e) { /* private mode / quota — skip */ }
  }

  function fetchLiveMd() {
    const bust = (FAQ_CONTENT_URL.includes('?') ? '&' : '?') + '_=' + Date.now();
    return fetch(FAQ_CONTENT_URL + bust, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function loadFaq() {
    fetchLiveMd()
      .then((md) => {
        writeCache(md);
        renderPage(MD.parse(md));
      })
      .catch((err) => {
        const cached = readCache();
        if (cached) {
          renderPage(MD.parse(cached), { fromCache: true });
          return;
        }
        renderError(err.message || String(err));
      });
  }

  loadFaq();
})();
