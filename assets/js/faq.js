'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   FAQ — fetch markdown content and render styled accordion page.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  // ── FAQ content URL ───────────────────────────────────────────────────────
  // Paste your public markdown URL here (same URL for localhost and production).
  // Supabase Storage example (public bucket "content", file "faq.md"):
  //   https://mmdmibimpipxckgfmhmz.supabase.co/storage/v1/object/public/content/faq.md
  // Until hosted, the local copy below works with `npx http-server`.
  const FAQ_CONTENT_URL = 'content/faq.md';

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

  function renderPage(data) {
    const sectionHtml = data.sections.map((section, idx) => {
      const tone = idx % 2 === 0 ? 'gold' : 'cyan';
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
      '<section class="faq-hero">' +
        '<div class="faq-beat-row live faq-rise d1" aria-hidden="true">' +
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

  fetch(FAQ_CONTENT_URL)
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then((md) => renderPage(parseFaqMd(md)))
    .catch((err) => renderError(err.message || String(err)));
})();
