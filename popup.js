/**
 * ChatGPT Deep Research → Markdown Extractor
 *
 * Usage: User first copies official Markdown via ChatGPT's Copy button,
 * then clicks this extension's button. The extension reads the clipboard,
 * extracts citation sources from the page sidebar, merges them as footnotes,
 * and writes the result back to the clipboard.
 *
 * Note: Auto-clicking ChatGPT's Copy button is not feasible because
 * navigator.clipboard.writeText() requires a trusted user gesture (isTrusted
 * click event), which cannot be provided programmatically from an extension.
 */


// =========================================================================
// Injection functions (run in page context via chrome.scripting.executeScript)
// These serve as FALLBACK strategies if the content script message approach
// doesn't work.
// =========================================================================

/**
 * Injection function: Extract citation sources (button[data-citation-index]).
 * Traverses child iframes to handle about:blank frames.
 */
function extractCitationSourcesOnly() {
  'use strict';

  function extractFromDoc(doc) {
    const citations = {};
    try {
      const allBtns = doc.querySelectorAll('button[data-citation-index]');
      allBtns.forEach(btn => {
        const idx = btn.getAttribute('data-citation-index');
        if (citations[idx]) return;
        let titleLink = null;
        const nextSib = btn.nextElementSibling;
        if (nextSib) {
          titleLink = nextSib.querySelector('a[href][target="_blank"]');
          if (!titleLink && nextSib.tagName === 'A' && nextSib.href) titleLink = nextSib;
        }
        if (!titleLink && btn.parentElement)
          titleLink = btn.parentElement.querySelector('a[href][target="_blank"]');
        if (!titleLink && btn.parentElement?.parentElement)
          titleLink = btn.parentElement.parentElement.querySelector('a[href][target="_blank"]');
        if (!titleLink && btn.parentElement?.parentElement?.parentElement)
          titleLink = btn.parentElement.parentElement.parentElement.querySelector('a[href][target="_blank"]');
        if (!titleLink) return;
        let url = titleLink.href;
        const fragIdx = url.indexOf('#:~:text=');
        if (fragIdx !== -1) url = url.substring(0, fragIdx);
        const title = titleLink.textContent.trim();
        if (title && url) citations[idx] = { url, title };
      });
    } catch (e) {}
    return citations;
  }

  let citations = extractFromDoc(document);
  if (Object.keys(citations).length === 0) {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) continue;
        Object.assign(citations, extractFromDoc(doc));
        const innerIframes = doc.querySelectorAll('iframe');
        for (const inner of innerIframes) {
          try {
            const innerDoc = inner.contentDocument || inner.contentWindow?.document;
            if (innerDoc) Object.assign(citations, extractFromDoc(innerDoc));
          } catch (e) {}
        }
      } catch (e) {}
    }
  }
  if (Object.keys(citations).length === 0) return null;
  return { citations, count: Object.keys(citations).length };
}


/**
 * Injection function: Extract citation ORDER (sup[data-citation-index]).
 * Traverses child iframes to handle about:blank frames.
 */
function extractCitationOrderFromContent() {
  'use strict';

  function extractFromDoc(doc) {
    try {
      const sups = doc.querySelectorAll('sup[data-citation-index]');
      if (sups.length === 0) return null;
      const order = [];
      sups.forEach(sup => order.push(sup.getAttribute('data-citation-index')));
      return { order, count: order.length };
    } catch (e) { return null; }
  }

  const directResult = extractFromDoc(document);
  if (directResult) return directResult;

  let bestResult = null;
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) continue;
      const result = extractFromDoc(doc);
      if (result && (!bestResult || result.count > bestResult.count)) bestResult = result;
      const innerIframes = doc.querySelectorAll('iframe');
      for (const inner of innerIframes) {
        try {
          const innerDoc = inner.contentDocument || inner.contentWindow?.document;
          if (!innerDoc) continue;
          const innerResult = extractFromDoc(innerDoc);
          if (innerResult && (!bestResult || innerResult.count > bestResult.count)) bestResult = innerResult;
        } catch (e) {}
      }
    } catch (e) {}
  }
  return bestResult;
}


// =========================================================================
// Detect trailing "References" section (language-agnostic)
// =========================================================================

/**
 * Detect a trailing "References" section in the markdown.
 * Instead of matching specific language keywords like "参考资料" or "References",
 * we look for a structural pattern: the last **bold heading** near the end of
 * the document, where the section after it contains citation markers 【N†...】
 * or [^N] footnotes and relatively little other content.
 *
 * @param {string} md - Markdown text
 * @param {Array|null} markers - Pre-extracted markers array (optional; if null, re-scan)
 * @returns {number} Start index of the references section, or -1 if not found
 */
function detectTrailingReferencesSection(md, markers) {
  // Find all **bold headings** (on their own line or at start of a line)
  const headingRegex = /\n\*\*[^*\n]+\*\*[：:\s]*/g;
  const headings = [];
  let m;
  while ((m = headingRegex.exec(md)) !== null) {
    headings.push({ index: m.index, match: m[0] });
  }
  if (headings.length === 0) return -1;

  // Check from the last heading backwards
  for (let h = headings.length - 1; h >= 0; h--) {
    const sectionStart = headings[h].index;
    const afterSection = md.substring(sectionStart);

    // Count citation markers in this trailing section
    const citationHits = (afterSection.match(/【\d+†[^】]*】/g) || []).length
                       + (afterSection.match(/\[\^\d+\]/g) || []).length;

    if (citationHits === 0) continue;

    // Heuristic: this section should be in the last ~30% of the document
    // and have a high density of citations relative to its length
    const positionRatio = sectionStart / md.length;
    const sectionTextLength = afterSection.replace(/【\d+†[^】]*】/g, '').replace(/\[\^\d+\]/g, '').trim().length;

    if (positionRatio >= 0.7 && citationHits >= 2 && sectionTextLength < afterSection.length * 0.8) {
      return sectionStart;
    }
  }

  return -1;
}


// =========================================================================
// Merge logic: replace 【N†...】 markers with [^K] using DOM position mapping
// =========================================================================
function mergeCitationsIntoMarkdown(officialMarkdown, citationMap, domCitationOrder) {
  // Step 1: Extract all 【N†...】 markers in document order
  const markerRegex = /【(\d+)†[^】]*】/g;
  const markers = [];
  let match;
  while ((match = markerRegex.exec(officialMarkdown)) !== null) {
    markers.push({
      start: match.index,
      end: match.index + match[0].length,
      officialId: match[1],
      fullMatch: match[0],
    });
  }

  if (markers.length === 0) {
    return { markdown: null, error: 'No citation markers (【N†...】) found in the copied text.' };
  }

  // Step 2: DOM position mapping (required — no fallback)
  if (!domCitationOrder || domCitationOrder.length === 0) {
    return {
      markdown: null,
      error: 'Cannot extract citation order from page DOM. Make sure the Deep Research report is expanded and visible.',
    };
  }

  let sidebarIndices = null;
  let mappingMethod = 'none';

  if (domCitationOrder.length === markers.length) {
    sidebarIndices = [...domCitationOrder];
    mappingMethod = 'position-exact';
  } else {
    // Try matching main-body markers only (exclude trailing "References" section).
    // Language-agnostic: detect the last **bold heading** near the end of the
    // document whose trailing section contains citation markers 【N†...】.
    const refSectionStart = detectTrailingReferencesSection(officialMarkdown, markers);
    if (refSectionStart !== -1) {
      const mainBodyMarkers = markers.filter(m => m.start < refSectionStart);
      if (domCitationOrder.length === mainBodyMarkers.length) {
        sidebarIndices = [...domCitationOrder];
        mappingMethod = 'position-main-body';
      }
    }

    // If DOM has more entries than markers — trim
    if (!sidebarIndices && domCitationOrder.length > markers.length) {
      sidebarIndices = domCitationOrder.slice(0, markers.length);
      mappingMethod = 'position-trimmed';
    }

    // If still no match, use what we have (best effort)
    if (!sidebarIndices) {
      sidebarIndices = domCitationOrder.slice(0, markers.length);
      mappingMethod = 'position-partial';
    }
  }

  // Step 3: Replace markers (back-to-front to preserve indices)
  let merged = officialMarkdown;
  const usedSidebarIndices = new Set();

  for (let i = markers.length - 1; i >= 0; i--) {
    const sidIdx = i < sidebarIndices.length ? sidebarIndices[i] : null;
    if (sidIdx) {
      usedSidebarIndices.add(sidIdx);
      merged = merged.substring(0, markers[i].start)
             + `[^${sidIdx}]`
             + merged.substring(markers[i].end);
    } else {
      merged = merged.substring(0, markers[i].start)
             + merged.substring(markers[i].end);
    }
  }

  // Step 4: Remove trailing "References" section (language-agnostic)
  const refStart = detectTrailingReferencesSection(merged, null);
  if (refStart !== -1) {
    merged = merged.substring(0, refStart);
  }

  // Step 5: Append footnote definitions
  merged = merged.trimEnd();
  merged += '\n\n---\n\n';

  const sortedIndices = [...usedSidebarIndices].sort((a, b) => parseInt(a) - parseInt(b));
  let resolvedCount = 0;
  for (const idx of sortedIndices) {
    const cite = citationMap[idx];
    if (cite) {
      const safeTitle = cite.title.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      merged += `[^${idx}]: [${safeTitle}](${cite.url})\n`;
      resolvedCount++;
    } else {
      merged += `[^${idx}]: Source ${idx}\n`;
    }
  }

  return {
    markdown: merged,
    totalCitations: usedSidebarIndices.size,
    resolvedCitations: resolvedCount,
    charCount: merged.length,
    mappingMethod,
  };
}


// =========================================================================
// Popup UI logic
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  const copyBtn = document.getElementById('copyBtn');
  const statusEl = document.getElementById('status');
  const statsEl = document.getElementById('stats');

  const BTN_LABEL = 'Merge Citations to Clipboard';

  copyBtn.addEventListener('click', async () => {
    setButtonState(copyBtn, true, 'Processing...');
    clearStatus();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        showError('No active tab found.');
        resetButton(copyBtn, BTN_LABEL);
        return;
      }

      // Step 1: Read clipboard (user should have already copied official markdown)
      statusEl.textContent = 'Reading clipboard...';
      statusEl.className = 'info';

      let clipboardText;
      try {
        clipboardText = await navigator.clipboard.readText();
      } catch (clipErr) {
        showError('Cannot read clipboard. Please allow the extension to access the clipboard.');
        resetButton(copyBtn, BTN_LABEL);
        return;
      }

      if (!clipboardText || clipboardText.trim().length < 20) {
        showError('Clipboard is empty or too short. Please click ChatGPT\'s Copy button first.');
        resetButton(copyBtn, BTN_LABEL);
        return;
      }

      if (!/【\d+†/.test(clipboardText)) {
        showError('No citation markers (【N†...】) found in clipboard. Please copy a Deep Research report first via ChatGPT\'s Copy button.');
        resetButton(copyBtn, BTN_LABEL);
        return;
      }

      // Step 2: Extract citation sources + DOM order from page
      statusEl.textContent = 'Extracting citation sources...';
      const citationMap = await extractCitationsFromPage(tab.id);
      const domCitationOrder = await extractCitationOrderFromPage(tab.id);

      if (!citationMap || Object.keys(citationMap).length === 0) {
        showError('No citation sources found. Please make sure the Sources sidebar is open and citations are visible.');
        resetButton(copyBtn, BTN_LABEL);
        return;
      }

      if (!domCitationOrder) {
        showError('Cannot extract citation order from the page. Please make sure the report is expanded and visible.');
        resetButton(copyBtn, BTN_LABEL);
        return;
      }

      // Step 3: Merge
      statusEl.textContent = 'Merging citations...';
      const result = mergeCitationsIntoMarkdown(clipboardText, citationMap, domCitationOrder);

      if (!result.markdown) {
        showError(result.error || 'Merge failed.');
        resetButton(copyBtn, BTN_LABEL);
        return;
      }

      // Step 4: Write merged markdown back to clipboard
      await navigator.clipboard.writeText(result.markdown);

      statusEl.textContent = '✓ Citations merged & copied to clipboard!';
      statusEl.className = 'success';
      copyBtn.textContent = '✓ Done';

      statsEl.innerHTML = `
        <span>${result.charCount.toLocaleString()}</span> chars ·
        <span>${result.resolvedCitations}</span>/<span>${result.totalCitations}</span> citations resolved ·
        ${result.mappingMethod}
      `;
      statsEl.style.display = 'block';

      setTimeout(() => resetButton(copyBtn, BTN_LABEL), 3000);

    } catch (err) {
      console.error('Error:', err);
      showError(`Error: ${err.message}`);
      resetButton(copyBtn, BTN_LABEL);
    }
  });


  // =====================================================================
  // Extraction helpers — THREE strategies in priority order:
  //   1. Content script message passing (most reliable for about:blank)
  //   2. executeScript frame-by-frame via webNavigation
  //   3. executeScript allFrames
  // =====================================================================

  async function _viaContentScript(tabId, action) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames) return [];
    const responses = [];
    for (const frame of frames) {
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { action }, { frameId: frame.frameId });
        if (resp) responses.push({ frameId: frame.frameId, url: frame.url, ...resp });
      } catch (e) { /* no content script in this frame */ }
    }
    return responses;
  }

  async function _viaExecuteScriptFrames(tabId, func) {
    const results = [];
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (frames) {
        for (const frame of frames) {
          try {
            const r = await chrome.scripting.executeScript({
              target: { tabId, frameIds: [frame.frameId] },
              func,
            });
            for (const item of r) { if (item.result) results.push(item.result); }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return results;
  }

  async function _viaExecuteScriptAll(tabId, func) {
    const results = [];
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func,
      });
      for (const item of r) { if (item.result) results.push(item.result); }
    } catch (e) {}
    return results;
  }

  async function extractCitationOrderFromPage(tabId) {
    // Strategy 1: content script
    try {
      const responses = await _viaContentScript(tabId, 'extractCitationOrder');
      let best = null;
      for (const r of responses) {
        if (r.count > 0 && (!best || r.count > best.count)) best = r;
      }
      if (best) return best.order;
    } catch (e) {}

    // Strategy 2: executeScript frame-by-frame
    {
      const results = await _viaExecuteScriptFrames(tabId, extractCitationOrderFromContent);
      let best = null;
      for (const r of results) { if (r?.order && (!best || r.count > best.count)) best = r; }
      if (best) return best.order;
    }

    // Strategy 3: executeScript allFrames
    {
      const results = await _viaExecuteScriptAll(tabId, extractCitationOrderFromContent);
      let best = null;
      for (const r of results) { if (r?.order && (!best || r.count > best.count)) best = r; }
      if (best) return best.order;
    }

    return null;
  }

  async function extractCitationsFromPage(tabId) {
    let allCitations = {};

    // Strategy 1: content script
    try {
      const responses = await _viaContentScript(tabId, 'extractCitationSources');
      for (const r of responses) {
        if (r.citations) Object.assign(allCitations, r.citations);
      }
      if (Object.keys(allCitations).length > 0) return allCitations;
    } catch (e) {}

    // Strategy 2: executeScript frame-by-frame
    {
      const results = await _viaExecuteScriptFrames(tabId, extractCitationSourcesOnly);
      for (const r of results) { if (r?.citations) Object.assign(allCitations, r.citations); }
      if (Object.keys(allCitations).length > 0) return allCitations;
    }

    // Strategy 3: executeScript allFrames
    {
      const results = await _viaExecuteScriptAll(tabId, extractCitationSourcesOnly);
      for (const r of results) { if (r?.citations) Object.assign(allCitations, r.citations); }
      if (Object.keys(allCitations).length > 0) return allCitations;
    }

    return allCitations;
  }

  // =====================================================================
  // UI helpers
  // =====================================================================

  function setButtonState(btn, disabled, text) {
    btn.disabled = disabled;
    btn.textContent = text;
  }

  function resetButton(btn, text) {
    btn.textContent = text;
    btn.disabled = false;
  }

  function clearStatus() {
    statusEl.textContent = '';
    statusEl.className = 'info';
    statsEl.style.display = 'none';
  }

  function showError(msg) {
    statusEl.textContent = msg;
    statusEl.className = 'error';
  }
});
