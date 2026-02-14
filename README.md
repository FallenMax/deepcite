# DeepCite — Deep Research Citations

> Export ChatGPT Deep Research reports to Markdown with citation sources preserved as footnotes.

ChatGPT's Deep Research feature produces excellent research reports with numbered citations, but when you copy the Markdown, all citation source information (URLs, titles) is lost — replaced by opaque markers like `【57†L18-L22】`. **DeepCite** fixes this by merging the citation sources from the page sidebar into the copied Markdown, producing clean footnotes like `[^13]: [Blue Yonder](https://...)`.

---

## Chrome Web Store Listing Materials

### Store Name (max 45 chars)

```
DeepCite - Deep Research Citations
```

### Short Description (max 132 chars)

```
Export ChatGPT Deep Research reports to Markdown with citation sources preserved as footnotes.
```

### Detailed Description

```
DeepCite solves a common frustration with ChatGPT Deep Research: when you copy the report as Markdown, all citation source information (URLs, website names) is lost. The citations appear as opaque markers like 【57†L18-L22】 instead of usable references.

DeepCite reads the official Markdown from your clipboard and the citation sources from the page sidebar, then merges them into clean Markdown footnotes — giving you a complete, well-referenced document ready for use in Notion, Obsidian, or any Markdown editor.

HOW IT WORKS:
1. Open a ChatGPT Deep Research report
2. Expand the report and open the Sources sidebar
3. Click ChatGPT's built-in Copy button
4. Click DeepCite's "合并引用到剪贴板" button
5. Paste — your Markdown now has full citation footnotes!

FEATURES:
• Preserves ChatGPT's official Markdown formatting perfectly
• Converts opaque citation markers to standard Markdown footnotes
• Uses DOM position-based mapping for accurate citation matching
• Handles reports with 30+ citation sources
• Works with deeply nested iframe content
• One-click operation after copying

EXAMPLE:
Before: 全球供应链管理软件市场约为257亿美元【57†L18-L22】
After:   全球供应链管理软件市场约为257亿美元[^13]
         ...
         [^13]: [Blue Yonder Revenue](https://www.example.com/...)

PRIVACY:
• No data is sent to any server
• No tracking or analytics
• All processing happens locally in your browser
• Only accesses chatgpt.com pages
```

### Category

```
Productivity
```

### Language

```
Chinese (Simplified) — with English documentation
```

---

## Store Visual Assets

| Asset | Size | Location |
|-------|------|----------|
| Store icon | 128x128 | `icons/icon128.png` |
| Extension icons | 16/48/128 | `icons/icon{16,48,128}.png` |
| Small promo tile | 440x280 | `store-assets/promo-small-440x280.png` |
| SVG source | vector | `icons/icon.svg` |

> **Screenshots**: Take 1–5 screenshots (1280x800 or 640x400) of the extension in use. Recommended shots:
> 1. The popup UI with the two-step instructions visible
> 2. A before/after comparison showing `【N†...】` → `[^N]: [Title](URL)`
> 3. The ChatGPT page with the sidebar open and the extension popup

---

## Usage

### Prerequisites

- Google Chrome (or Chromium-based browser)
- ChatGPT account with Deep Research access

### Install from Source (Developer Mode)

1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select this directory
5. Pin the extension to the toolbar

### How to Use

1. Open a ChatGPT conversation with a **Deep Research** report
2. **Expand** the full report (click to reveal)
3. Open the **Sources** sidebar (click "Sources" tab on the right)
4. Click ChatGPT's built-in **Copy** button (below the report)
5. Click the **DeepCite** extension icon → **"合并引用到剪贴板"**
6. Paste anywhere — your Markdown now includes full citation footnotes!

### Output Format

The merged Markdown preserves ChatGPT's original formatting and appends footnote definitions:

```markdown
## 1. Market Size & Growth

- Global SCM software market was valued at USD 25.67 billion in 2024[^1]
- AI supply chain segment growing at CAGR ~20.2%[^4]

---

[^1]: [Supply Chain Management Market Size & Share](https://www.grandviewresearch.com/...)
[^4]: [AI in Supply Chain Market Report](https://www.marketsandmarkets.com/...)
```

---

## Technical Details

### Architecture

- **Manifest V3** Chrome extension
- **Content script** (`content.js`): Injected into `oaiusercontent.com` iframes (including `about:blank` children via `match_about_blank`) to extract citation data from the deeply nested DOM
- **Popup** (`popup.js`): Orchestrates clipboard reading, citation extraction (via message passing to content script), merging, and clipboard writing
- **Citation mapping**: Position-based — matches the N-th `【...】` marker in the Markdown to the N-th `<sup data-citation-index>` in the DOM, then resolves to sidebar `<button data-citation-index>` sources

### Why not auto-click ChatGPT's Copy button?

The browser's Clipboard API (`navigator.clipboard.writeText()`) requires a **trusted user gesture** (`isTrusted` click event). Programmatic clicks from extensions don't qualify, so auto-copying is not feasible. See [Chromium User Activation docs](https://chromium.googlesource.com/chromium/src/+/master/docs/user_activation.md).

---

## Privacy Policy

DeepCite does **not** collect, transmit, or store any user data. All processing happens entirely within your browser. The extension only accesses `chatgpt.com` and `oaiusercontent.com` pages to extract citation information from the DOM. No analytics, no tracking, no external network requests.

---

## License

MIT
