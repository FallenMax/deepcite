/**
 * Content script for ChatGPT Deep Research → Markdown extension.
 *
 * Injected into oaiusercontent.com frames (including about:blank children)
 * via manifest.json content_scripts with match_about_blank: true.
 *
 * IMPORTANT: The about:blank iframe containing actual content is often
 * dynamically created by React AFTER the initial content script injection.
 * Therefore, message handlers must traverse child iframes via contentDocument
 * to find the elements, not just query the current document.
 */

'use strict';

// Mark this frame so we can verify content script injection from outside
document.documentElement.setAttribute('data-chatgpt-md-ext', 'loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractCitationOrder') {
    const result = findSupsInDocTree(document);
    sendResponse(result);
    return;
  }

  if (request.action === 'extractCitationSources') {
    const result = findButtonsInDocTree(document);
    sendResponse(result);
    return;
  }

  if (request.action === 'ensureSidebarOpen') {
    const result = ensureSidebarOpen(document);
    sendResponse(result);
    return;
  }

  if (request.action === 'ping') {
    sendResponse({ ok: true, url: window.location.href });
    return;
  }
});


/**
 * Find and click "Sources and activity" button to open the sidebar.
 * The sidebar must be open for button[data-citation-index] to be in the DOM.
 */
function ensureSidebarOpen(rootDoc) {
  const docs = collectAccessibleDocs(rootDoc);
  for (const doc of docs) {
    try {
      // Check if sidebar is already open (button[data-citation-index] exists)
      if (doc.querySelectorAll('button[data-citation-index]').length > 0) {
        return { status: 'already-open', buttonCount: doc.querySelectorAll('button[data-citation-index]').length };
      }
    } catch (e) {}
  }

  // Try to click the "Sources and activity" button
  for (const doc of docs) {
    try {
      const allBtns = doc.querySelectorAll('button');
      for (const btn of allBtns) {
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const text = btn.textContent?.trim() || '';
        if (ariaLabel.includes('Sources') || ariaLabel.includes('source') ||
            text.includes('Sources') || text.includes('source')) {
          btn.click();
          return { status: 'clicked', target: text || ariaLabel };
        }
      }
    } catch (e) {}
  }

  return { status: 'not-found' };
}


/**
 * Search for sup[data-citation-index] in this document and all accessible
 * child/grandchild iframe documents (handles dynamically created about:blank).
 */
function findSupsInDocTree(rootDoc) {
  const docs = collectAccessibleDocs(rootDoc);
  let bestOrder = null;
  let bestCount = 0;

  for (const doc of docs) {
    try {
      const sups = doc.querySelectorAll('sup[data-citation-index]');
      if (sups.length > bestCount) {
        bestCount = sups.length;
        const order = [];
        sups.forEach(sup => order.push(sup.getAttribute('data-citation-index')));
        bestOrder = order;
      }
    } catch (e) { /* cross-origin */ }
  }

  return { order: bestOrder || [], count: bestCount };
}


/**
 * Search for button[data-citation-index] in this document and all accessible
 * child/grandchild iframe documents.
 */
function findButtonsInDocTree(rootDoc) {
  const docs = collectAccessibleDocs(rootDoc);
  const citations = {};

  for (const doc of docs) {
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
        if (!titleLink && btn.parentElement) {
          titleLink = btn.parentElement.querySelector('a[href][target="_blank"]');
        }
        if (!titleLink && btn.parentElement?.parentElement) {
          titleLink = btn.parentElement.parentElement.querySelector('a[href][target="_blank"]');
        }
        if (!titleLink && btn.parentElement?.parentElement?.parentElement) {
          titleLink = btn.parentElement.parentElement.parentElement.querySelector('a[href][target="_blank"]');
        }
        if (!titleLink) return;

        let url = titleLink.href;
        const fragIdx = url.indexOf('#:~:text=');
        if (fragIdx !== -1) url = url.substring(0, fragIdx);

        const title = titleLink.textContent.trim();
        if (title && url) citations[idx] = { url, title };
      });
    } catch (e) { /* cross-origin */ }
  }

  return { citations, count: Object.keys(citations).length };
}


/**
 * Collect all accessible documents: the root document + child iframes'
 * contentDocuments (up to 2 levels deep). about:blank iframes inherit
 * the parent origin, so contentDocument access works.
 */
function collectAccessibleDocs(rootDoc) {
  const docs = [rootDoc];

  try {
    const iframes = rootDoc.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const childDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (childDoc) {
          docs.push(childDoc);
          // One level deeper
          try {
            const innerIframes = childDoc.querySelectorAll('iframe');
            for (const inner of innerIframes) {
              try {
                const innerDoc = inner.contentDocument || inner.contentWindow?.document;
                if (innerDoc) docs.push(innerDoc);
              } catch (e) { /* cross-origin */ }
            }
          } catch (e) { /* error */ }
        }
      } catch (e) { /* cross-origin */ }
    }
  } catch (e) { /* error */ }

  return docs;
}
