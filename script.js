// ==UserScript==
// @name         Claude Project Files Extractor
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Download/extract all files from a Claude project
// @author       sharmanhall
// @match        https://claude.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=claude.ai
// @license      MIT
// @downloadURL  https://update.greasyfork.org/scripts/541467/Claude%20Project%20Files%20Extractor.user.js
// @updateURL    https://update.greasyfork.org/scripts/541467/Claude%20Project%20Files%20Extractor.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function waitForModal(timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const modal = document.querySelector('[role="dialog"]');
            if (modal?.offsetHeight > 0) {
                await sleep(500);
                return modal;
            }
            await sleep(100);
        }
        return null;
    }

    async function closeModal() {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
    }

    function getFilename(element) {
        const text = element.textContent.trim();
        const match = text.match(/^([^\n]+?\.[a-zA-Z0-9]{1,5})(?:\s|$)/m) ||
                      text.match(/^(.+?)\s*\n/);
        if (match?.[1]) return match[1].trim();
        return text.split('\n')[0].substring(0, 50) || 'file_' + Date.now();
    }

    function getContent(modal) {
        for (const sel of ['pre code', 'pre', '[class*="whitespace-pre"]', '[class*="font-mono"]']) {
            const el = modal.querySelector(sel);
            if (el?.textContent?.length > 50) return el.textContent;
        }
        return modal.textContent || '';
    }

    function findFiles() {
        const files = [];
        const seen = new Set();
        const elements = document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"]');

        for (const el of elements) {
            const text = el.textContent?.trim() || '';
            if (seen.has(text) || text.length < 5 || text.length > 500) continue;
            if (/^(New chat|Settings|Help|Close|Cancel|OK|Edit|Delete|Copy)$/i.test(text)) continue;

            if (/\d+\s*lines?/i.test(text) || /\.[a-zA-Z0-9]{1,5}(\s|$)/.test(text)) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    files.push(el);
                    seen.add(text);
                }
            }
        }
        return files;
    }

    function cleanFilename(name) {
        return name
            .replace(/\s*\d+\s*lines?\s*$/i, '')
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_');
    }

    function download(filename, content) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function exportProject() {
        const btn = document.querySelector('#claude-export-btn');
        if (!btn) return;

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Scanning...';

        try {
            const fileElements = findFiles();
            if (fileElements.length === 0) {
                alert('No project files found. Make sure you are on a Claude project page with knowledge files.');
                return;
            }

            const files = [];
            for (let i = 0; i < fileElements.length; i++) {
                btn.textContent = `Extracting ${i + 1}/${fileElements.length}...`;
                const el = fileElements[i];

                el.scrollIntoView({ block: 'center' });
                await sleep(200);
                el.click();

                const modal = await waitForModal();
                if (!modal) continue;

                const content = getContent(modal);
                if (content.length > 10) {
                    let filename = cleanFilename(getFilename(el));
                    if (!/\.[a-zA-Z0-9]{1,5}$/.test(filename)) filename += '.txt';
                    files.push({ filename, content });
                }

                await closeModal();
                await sleep(500);
            }

            btn.textContent = `Downloading ${files.length} files...`;
            for (let i = 0; i < files.length; i++) {
                await sleep(300);
                download(files[i].filename, files[i].content);
            }
            btn.textContent = `Done! ${files.length} files`;

        } catch (e) {
            console.error('[Extractor]', e);
            alert('Export failed: ' + e.message);
        } finally {
            btn.disabled = false;
            setTimeout(() => btn.textContent = originalText, 3000);
        }
    }

    function addButton() {
        document.querySelector('#claude-export-btn')?.remove();

        const btn = document.createElement('button');
        btn.id = 'claude-export-btn';
        btn.textContent = 'Export Project Files';
        btn.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; padding: 12px 20px;
            background: linear-gradient(135deg, #667eea, #764ba2); color: white;
            border: none; border-radius: 8px; cursor: pointer; z-index: 10000;
            font: 600 14px system-ui; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        `;
        btn.onclick = exportProject;
        document.body.appendChild(btn);
    }

    // Init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addButton);
    } else {
        addButton();
    }

    // Re-add on SPA navigation
    let url = location.href;
    new MutationObserver(() => {
        if (location.href !== url) {
            url = location.href;
            setTimeout(addButton, 1000);
        }
    }).observe(document.body, { childList: true, subtree: true });
})();
