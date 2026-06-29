'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   FAQ MARKDOWN — shared parser + HTML renderer for FAQ and Patch Notes pages.
   Schema: # **Title**, optional <!-- released: YYYY-MM-DD -->, lede, --- ## **Section**, **Item** body.
   ════════════════════════════════════════════════════════════════════════════ */
window.FaqMarkdown = (function () {
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

  const SECTION_DELIM = /\n\s*---\s*\n/;
  const RELEASED_COMMENT = /<!--\s*released:\s*(\d{4}-\d{2}-\d{2})\s*-->/i;

  function extractReleasedDate(text) {
    const match = text.match(RELEASED_COMMENT);
    return match ? match[1] : null;
  }

  function stripReleasedMetadata(text) {
    return text
      .replace(RELEASED_COMMENT, '')
      .replace(/^released:\s*\d{4}-\d{2}-\d{2}\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function parseSectionTitle(part) {
    const bold = part.match(/^##\s+\*\*(.+?)\*\*\s*\n([\s\S]*)$/);
    if (bold) return { title: bold[1], body: bold[2] };
    const plain = part.match(/^##\s+(.+?)\s*\n([\s\S]*)$/);
    if (plain) return { title: plain[1].trim(), body: plain[2] };
    return null;
  }

  function parse(md) {
    const normalized = normalizeMd(md);
    const releasedDate = extractReleasedDate(normalized);
    const parts = normalized.split(SECTION_DELIM);
    let head = stripReleasedMetadata(parts[0] || '');
    const titleMatch = head.match(/^#\s+\*\*(.+?)\*\*/m);
    const title = titleMatch ? titleMatch[1] : 'FAQ';
    const lede = head.replace(/^#\s+\*\*.+?\*\*\s*\n?/, '').trim();

    const sections = [];
    for (let i = 1; i < parts.length; i++) {
      const part = stripReleasedMetadata(parts[i].trim());
      const section = parseSectionTitle(part);
      if (!section) continue;
      sections.push({
        title: section.title,
        items: parseSectionItems(section.body),
      });
    }

    return { title, lede, releasedDate, sections };
  }

  function renderSectionsHtml(sections, startToneIdx) {
    startToneIdx = startToneIdx || 0;
    return sections.map((section, idx) => {
      const tone = (startToneIdx + idx) % 2 === 0 ? 'gold' : 'cyan';
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
  }

  function renderPatchSectionsHtml(sections, startToneIdx) {
    startToneIdx = startToneIdx || 0;
    return sections.map((section, idx) => {
      const tone = (startToneIdx + idx) % 2 === 0 ? 'gold' : 'cyan';
      const entriesHtml = section.items.map((item) =>
        '<p class="pn-entry">' +
          '<strong class="pn-entry-title">' + escapeHtml(item.q) + '</strong>' +
          '<span class="pn-entry-desc">' + inlineMd(item.a) + '</span>' +
        '</p>'
      ).join('');

      return (
        '<section class="faq-section ' + tone + ' faq-rise d2">' +
          '<div class="faq-section-head">' +
            '<div class="faq-section-hex" aria-hidden="true"></div>' +
            '<h2 class="faq-section-title">' + escapeHtml(section.title) + '</h2>' +
            '<div class="faq-section-line" aria-hidden="true"></div>' +
          '</div>' +
          '<div class="pn-section-body panel">' + entriesHtml + '</div>' +
        '</section>'
      );
    }).join('');
  }

  return {
    normalizeMd,
    escapeHtml,
    inlineMd,
    renderAnswer,
    parse,
    renderSectionsHtml,
    renderPatchSectionsHtml,
  };
})();
