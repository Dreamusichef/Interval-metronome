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
  function normalizeMd(raw) {
    return raw
      .replace(/\r\n/g, '\n')
      .replace(/\\([)\-])/g, '$1');
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inlineMd(text) {
    return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function renderAnswer(text) {
    const lines = text.split('\n');
    const parts = [];
    let i = 0;

    while (i < lines.length) {
      while (i < lines.length && !lines[i].trim()) i++;
      if (i >= lines.length) break;

      const trimmed = lines[i].trim();
      if (/^\d+\.\s/.test(trimmed)) {
        parts.push('<ol>');
        while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
          const item = lines[i].trim().replace(/^\d+\.\s*/, '');
          parts.push('<li>' + inlineMd(item) + '</li>');
          i++;
        }
        parts.push('</ol>');
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() && !/^\d+\.\s/.test(lines[i].trim())) {
        para.push(lines[i].trim());
        i++;
      }
      if (para.length) {
        parts.push('<p>' + inlineMd(para.join(' ')) + '</p>');
      }
    }

    return parts.join('');
  }

  function parseSectionItems(body) {
    const lines = body.split('\n');
    const items = [];
    let current = null;

    function flush() {
      if (!current) return;
      items.push({
        q: current.q,
        a: current.lines.join('\n').trim(),
      });
      current = null;
    }

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        if (current) current.lines.push('');
        continue;
      }

      const inline = line.match(/^\*\*(.+?)\*\*\s+(.+)$/);
      const questionOnly = line.match(/^\*\*(.+\?)\*\*\s*$/);

      if (inline) {
        flush();
        current = { q: inline[1], lines: [inline[2]] };
      } else if (questionOnly) {
        flush();
        current = { q: questionOnly[1], lines: [] };
      } else if (current) {
        current.lines.push(line);
      }
    }

    flush();
    return items.filter((item) => item.q && item.a);
  }

  function parseFaqMd(md) {
    const parts = normalizeMd(md).split(/\n---\n/);
    const head = parts[0] || '';
    const titleMatch = head.match(/^#\s+\*\*(.+?)\*\*/m);
    const title = titleMatch ? titleMatch[1] : 'FAQ';
    const lede = head.replace(/^#\s+\*\*.+?\*\*\s*\n?/, '').trim();

    const sections = [];
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      const sectionMatch = part.match(/^##\s+\*\*(.+?)\*\*\s*\n([\s\S]*)$/);
      if (!sectionMatch) continue;
      sections.push({
        title: sectionMatch[1],
        items: parseSectionItems(sectionMatch[2]),
      });
    }

    return { title, lede, sections };
  }

  function renderPage(data, opts) {
    const fromCache = opts && opts.fromCache;
    const sectionHtml = data.sections.map((section, idx) => {      const tone = idx % 2 === 0 ? 'gold' : 'cyan';
      const itemsHtml = section.items.map((item) =>
        '<details class="faq-item panel">' +
          '<summary>' + escapeHtml(item.q) + '</summary>' +
          '<div class="faq-answer">' + renderAnswer(item.a) + '</div>' +
        '</details>'
      ).join('');

      return (
        '<section class="faq-section ' + tone + ' faq-rise d2">' +
          '<div class="faq-section-head">' +
            '<div class="faq-section-hex" aria-hidden="true"></div>' +
            '<h2 class="faq-section-title">' + escapeHtml(section.title) + '</h2>' +
            '<div class="faq-section-line" aria-hidden="true"></div>' +
          '</div>' +
          '<div class="faq-items">' + itemsHtml + '</div>' +
        '</section>'
      );
    }).join('');

    root.innerHTML =
      (fromCache
        ? '<p class="faq-cache-notice faq-rise" role="status">Showing a saved copy — live FAQ is temporarily unavailable.</p>'
        : '') +
      '<section class="faq-hero">' +        '<div class="faq-beat-row live faq-rise d1" aria-hidden="true">' +
          '<div class="faq-hex accent"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
          '<div class="faq-hex"></div>' +
        '</div>' +
        '<p class="faq-eyebrow faq-rise d1">Help &amp; Support</p>' +
        '<h1 class="faq-title faq-rise d2">' + escapeHtml(data.title) + '</h1>' +
        (data.lede ? '<p class="faq-lede faq-rise d3">' + inlineMd(data.lede) + '</p>' : '') +
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
        '<p>' + escapeHtml(message) + '</p>' +
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
        renderPage(parseFaqMd(md));
      })
      .catch((err) => {
        const cached = readCache();
        if (cached) {
          renderPage(parseFaqMd(cached), { fromCache: true });
          return;
        }
        renderError(err.message || String(err));
      });
  }

  loadFaq();
})();