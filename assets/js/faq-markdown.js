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

  function inlineMdRich(text) {
    const parts = [];
    const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(escapeHtml(text.slice(last, m.index)));
      if (m[1] !== undefined) {
        const href = m[2].trim();
        const safeHref = /^(https?:\/\/|mailto:)/i.test(href) ? href : '#';
        parts.push(
          '<a href="' + escapeHtml(safeHref) + '" rel="noopener noreferrer">' +
            escapeHtml(m[1]) +
          '</a>'
        );
      } else {
        parts.push('<strong>' + escapeHtml(m[3]) + '</strong>');
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(escapeHtml(text.slice(last)));
    return parts.join('');
  }

  function parseTableRow(line) {
    return line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  function isTableSeparator(line) {
    return /^\|[\s:|\-]+\|$/.test(line.trim());
  }

  function renderTable(tableLines) {
    if (tableLines.length < 2) return '';
    const header = parseTableRow(tableLines[0]);
    let bodyStart = 1;
    if (isTableSeparator(tableLines[1])) bodyStart = 2;
    const rows = tableLines.slice(bodyStart).map(parseTableRow);
    const headHtml = header.map((cell) => '<th>' + inlineMdRich(cell) + '</th>').join('');
    const bodyHtml = rows.map((row) =>
      '<tr>' + row.map((cell) => '<td>' + inlineMdRich(cell) + '</td>').join('') + '</tr>'
    ).join('');
    return (
      '<div class="legal-table-wrap panel">' +
        '<table class="legal-table">' +
          '<thead><tr>' + headHtml + '</tr></thead>' +
          '<tbody>' + bodyHtml + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  function renderLegalBody(body) {
    const lines = body.split('\n');
    const parts = [];
    let i = 0;

    while (i < lines.length) {
      while (i < lines.length && !lines[i].trim()) i++;
      if (i >= lines.length) break;

      const trimmed = lines[i].trim();

      const h3Bold = trimmed.match(/^###\s+\*\*(.+?)\*\*\s*$/);
      const h3Plain = !h3Bold && trimmed.match(/^###\s+(.+?)\s*$/);
      if (h3Bold || h3Plain) {
        parts.push('<h3 class="legal-h3">' + inlineMdRich((h3Bold || h3Plain)[1]) + '</h3>');
        i++;
        continue;
      }

      if (trimmed.startsWith('|')) {
        const tableLines = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i].trim());
          i++;
        }
        parts.push(renderTable(tableLines));
        continue;
      }

      if (trimmed.startsWith('- ')) {
        parts.push('<ul class="legal-list">');
        while (i < lines.length && lines[i].trim().startsWith('- ')) {
          parts.push('<li>' + inlineMdRich(lines[i].trim().replace(/^-\s+/, '')) + '</li>');
          i++;
        }
        parts.push('</ul>');
        continue;
      }

      if (/^\d+\.\s/.test(trimmed)) {
        parts.push('<ol class="legal-list">');
        while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
          parts.push('<li>' + inlineMdRich(lines[i].trim().replace(/^\d+\.\s*/, '')) + '</li>');
          i++;
        }
        parts.push('</ol>');
        continue;
      }

      const para = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) break;
        if (t.startsWith('###') || t.startsWith('|') || t.startsWith('- ') || /^\d+\.\s/.test(t)) break;
        para.push(t);
        i++;
      }
      if (para.length) {
        parts.push('<p>' + inlineMdRich(para.join(' ')) + '</p>');
      }
    }

    return parts.join('');
  }

  function parseLegal(md) {
    const normalized = normalizeMd(md);
    const parts = normalized.split(SECTION_DELIM);
    let head = (parts[0] || '').trim();
    const titleMatch = head.match(/^#\s+\*\*(.+?)\*\*/m);
    const title = titleMatch ? titleMatch[1] : 'Legal';
    head = head.replace(/^#\s+\*\*.+?\*\*\s*\n?/, '').trim();

    const meta = [];
    const introLines = [];
    for (const raw of head.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const metaMatch = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
      if (metaMatch) {
        meta.push({ label: metaMatch[1], value: metaMatch[2] });
      } else {
        introLines.push(line);
      }
    }

    const sections = [];
    let footer = '';
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      const section = parseSectionTitle(part);
      if (!section) {
        const italic = part.match(/^\*(.+)\*$/);
        if (italic) footer = italic[1].trim();
        continue;
      }
      sections.push({ title: section.title, body: section.body.trim() });
    }

    return {
      title,
      meta,
      intro: introLines.join('\n').trim(),
      sections,
      footer,
    };
  }

  function renderLegalDocumentHtml(data, startToneIdx) {
    startToneIdx = startToneIdx || 0;
    const metaHtml = data.meta.length
      ? '<dl class="legal-meta panel faq-rise d2">' +
          data.meta.map((row) =>
            '<div class="legal-meta-row">' +
              '<dt>' + escapeHtml(row.label) + '</dt>' +
              '<dd>' + inlineMdRich(row.value) + '</dd>' +
            '</div>'
          ).join('') +
        '</dl>'
      : '';

    const sectionsHtml = data.sections.map((section, idx) => {
      const tone = (startToneIdx + idx) % 2 === 0 ? 'gold' : 'cyan';
      return (
        '<section class="faq-section legal-section ' + tone + ' faq-rise d2" id="legal-' + (idx + 1) + '">' +
          '<div class="faq-section-head">' +
            '<div class="faq-section-hex" aria-hidden="true"></div>' +
            '<h2 class="faq-section-title">' + escapeHtml(section.title) + '</h2>' +
            '<div class="faq-section-line" aria-hidden="true"></div>' +
          '</div>' +
          '<div class="legal-section-body panel">' + renderLegalBody(section.body) + '</div>' +
        '</section>'
      );
    }).join('');

    return { metaHtml, sectionsHtml, footerHtml: data.footer
      ? '<p class="legal-updated faq-rise d3"><em>' + inlineMdRich(data.footer) + '</em></p>'
      : '' };
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
    inlineMdRich,
    renderAnswer,
    renderLegalBody,
    parse,
    parseLegal,
    renderSectionsHtml,
    renderPatchSectionsHtml,
    renderLegalDocumentHtml,
  };
})();
