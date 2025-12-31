// ==UserScript==
// @name         Claude Project Files Extractor
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Download/extract all files from a Claude project as a single ZIP
// @author       sharmanhall
// @match        https://claude.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=claude.ai
// @grant        GM_xmlhttpRequest
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @license      MIT
// @downloadURL  https://update.greasyfork.org/scripts/541467/Claude%20Project%20Files%20Extractor.user.js
// @updateURL    https://update.greasyfork.org/scripts/541467/Claude%20Project%20Files%20Extractor.meta.js
// ==/UserScript==

(function() {
    'use strict';

    // JSZip is now loaded via @require, no dynamic loading needed

    // Helper function to wait for modal to appear
    async function waitForModal(timeout = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const modal = document.querySelector('[role="dialog"]');
            if (modal && modal.offsetHeight > 0) {
                // Wait a bit more for content to load
                await new Promise(resolve => setTimeout(resolve, 1000));
                return modal;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
    }

    // Helper function to wait for modal to close
    async function waitForModalClose(timeout = 3000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const modal = document.querySelector('[role="dialog"]');
            if (!modal || modal.offsetHeight === 0) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    }

    // Function to close modal
    async function closeModal() {
        console.log('[Extractor] Attempting to close modal...');

        // Try clicking close button first
        const closeSelectors = [
            'button[aria-label*="close" i]',
            'button[aria-label*="Close" i]',
            '[data-testid*="close"]',
            '[role="dialog"] button[type="button"]',
            '[role="dialog"] svg[class*="close"]',
            '[role="dialog"] button:has(svg)'
        ];

        for (const selector of closeSelectors) {
            try {
                const buttons = document.querySelectorAll(selector);
                for (const btn of buttons) {
                    // Look for close buttons (usually small, at top right)
                    const rect = btn.getBoundingClientRect();
                    if (rect.width < 60 && rect.height < 60) {
                        console.log(`[Extractor] Trying close button: ${selector}`);
                        btn.click();
                        await new Promise(resolve => setTimeout(resolve, 300));
                        if (await waitForModalClose(1000)) {
                            console.log('[Extractor] Modal closed successfully');
                            return true;
                        }
                    }
                }
            } catch (e) {
                // continue
            }
        }

        // Press Escape
        for (let i = 0; i < 3; i++) {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27,
                bubbles: true,
                cancelable: true
            }));
            await new Promise(resolve => setTimeout(resolve, 200));
            if (await waitForModalClose(500)) {
                console.log('[Extractor] Modal closed via Escape');
                return true;
            }
        }

        // Click backdrop
        const backdrop = document.querySelector('[data-state="open"][data-aria-hidden="true"]') ||
                         document.querySelector('.fixed.inset-0') ||
                         document.querySelector('[role="dialog"]')?.parentElement;
        if (backdrop) {
            const rect = backdrop.getBoundingClientRect();
            const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + 5,
                clientY: rect.top + 5
            });
            backdrop.dispatchEvent(clickEvent);
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        const closed = await waitForModalClose();
        console.log(closed ? '[Extractor] Modal closed' : '[Extractor] Failed to close modal');
        return closed;
    }

    // Extract filename from element text
    function extractFileName(element) {
        // Try to find a dedicated filename element first
        const filenameEl = element.querySelector('[class*="filename"], [class*="name"], [title]');
        if (filenameEl) {
            const title = filenameEl.getAttribute('title') || filenameEl.textContent;
            if (title && title.trim().length > 0 && title.trim().length < 200) {
                return title.trim();
            }
        }

        const text = element.textContent.trim();
        console.log('[Extractor] Analyzing element text:', text.substring(0, 100));

        // Look for filename patterns - file.ext followed by metadata
        const patterns = [
            /^([^\n]+?\.[a-zA-Z0-9]{1,5})(?:\s|$)/m,  // filename.ext at start
            /^(.+?)\s*\n/,  // First line before newline
            /^([^0-9\n]+?)(?:\s*\d+\s*(?:lines?|bytes?|KB|MB))/i  // Name before size info
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1].trim().length > 2) {
                const filename = match[1].trim();
                console.log('[Extractor] Extracted filename:', filename);
                return filename;
            }
        }

        // Fallback: take first line or first 50 chars
        const firstLine = text.split('\n')[0].trim();
        if (firstLine.length > 2 && firstLine.length < 100) {
            return firstLine;
        }

        return 'Unknown_File_' + Date.now();
    }

    // Detect file type from filename and content
    function detectFileType(filename, content) {
        const lower = filename.toLowerCase();

        // Check filename extension
        const extMatch = lower.match(/\.([a-zA-Z0-9]+)$/);
        if (extMatch) {
            const ext = extMatch[1];
            // For binary formats that were converted to text, append .txt
            if (['pdf', 'doc', 'docx', 'xlsx', 'xls', 'ppt', 'pptx'].includes(ext)) {
                return ext + '.txt';
            }
            return ext;
        }

        // Infer from content
        const trimmed = content.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                JSON.parse(trimmed);
                return 'json';
            } catch (e) { /* not valid JSON */ }
        }
        if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) return 'xml';
        if (trimmed.includes('# ') || trimmed.includes('## ')) return 'md';
        if (content.includes(',') && content.split('\n').every(line => line.split(',').length > 1)) return 'csv';

        return 'txt';
    }

    // Extract content from the modal
    function extractContentFromModal(modal) {
        console.log('[Extractor] Extracting content from modal...');

        // Priority order for content containers
        const contentSelectors = [
            'pre code',
            'pre',
            '[class*="whitespace-pre"]',
            '[class*="font-mono"]',
            '[class*="code"]',
            '[class*="content"]:not([class*="dialog"])',
            '.overflow-auto',
            '.overflow-y-auto'
        ];

        for (const selector of contentSelectors) {
            const elements = modal.querySelectorAll(selector);
            for (const element of elements) {
                const text = element.textContent?.trim();
                if (text && text.length > 50) {
                    console.log(`[Extractor] Found content in: ${selector} (${text.length} chars)`);
                    return text;
                }
            }
        }

        // Fallback: get modal body content, filtering out buttons/controls
        const modalContent = modal.cloneNode(true);

        // Remove buttons, headers, footers
        modalContent.querySelectorAll('button, [role="button"], header, footer, nav').forEach(el => el.remove());

        const text = modalContent.textContent?.trim();
        if (text && text.length > 50) {
            console.log(`[Extractor] Using fallback extraction (${text.length} chars)`);
            return text;
        }

        console.log('[Extractor] No content found in modal');
        return '';
    }

    // Find file elements in the project knowledge panel
    function findFileElements() {
        console.log('[Extractor] Searching for file elements...');

        const fileElements = [];
        const seenTexts = new Set();

        // Look for the project knowledge section - it's usually in a sidebar or panel
        // Claude typically shows files as clickable items with file info

        // Strategy 1: Look for elements with "lines" text (file size indicator)
        const allElements = document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"], div[tabindex="0"]');

        for (const element of allElements) {
            const text = element.textContent?.trim() || '';

            // Skip if already seen this text (avoid duplicates)
            if (seenTexts.has(text)) continue;

            // Skip if too short or too long
            if (text.length < 5 || text.length > 500) continue;

            // Skip obvious UI elements
            if (/^(New chat|Settings|Help|Log out|Sign in|Export|Download|Close|Cancel|OK|Edit|View|Delete|Copy|Share)$/i.test(text)) continue;

            // Look for file indicators
            const hasLinesIndicator = /\d+\s*lines?/i.test(text);
            const hasFileExtension = /\.[a-zA-Z0-9]{1,5}(\s|$)/.test(text);
            const hasSizeIndicator = /\d+\s*(KB|MB|bytes?)/i.test(text);

            if (hasLinesIndicator || hasFileExtension || hasSizeIndicator) {
                // Verify it's clickable and visible
                const rect = element.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    console.log(`[Extractor] Found file element: ${text.substring(0, 60)}...`);
                    fileElements.push(element);
                    seenTexts.add(text);
                }
            }
        }

        // Strategy 2: Look for list items in a "knowledge" or "files" section
        if (fileElements.length === 0) {
            const containers = document.querySelectorAll('[class*="knowledge"], [class*="files"], [class*="documents"], [class*="project"]');
            for (const container of containers) {
                const items = container.querySelectorAll('li, [role="listitem"], > div > div');
                for (const item of items) {
                    const text = item.textContent?.trim() || '';
                    if (text.length > 5 && text.length < 500 && !seenTexts.has(text)) {
                        const rect = item.getBoundingClientRect();
                        if (rect.width > 50 && rect.height > 20) {
                            console.log(`[Extractor] Found file in container: ${text.substring(0, 60)}...`);
                            fileElements.push(item);
                            seenTexts.add(text);
                        }
                    }
                }
            }
        }

        console.log(`[Extractor] Found ${fileElements.length} file elements`);
        return fileElements;
    }

    // Extract project knowledge files
    async function extractProjectFiles(statusCallback) {
        const files = [];

        console.log('[Extractor] Looking for project knowledge files...');
        statusCallback('Scanning for files...');

        const fileElements = findFileElements();

        if (fileElements.length === 0) {
            console.log('[Extractor] No file elements found');
            return files;
        }

        statusCallback(`Found ${fileElements.length} files, extracting...`);

        for (let i = 0; i < fileElements.length; i++) {
            const element = fileElements[i];

            try {
                const rawFilename = extractFileName(element);
                console.log(`[Extractor] Processing file ${i + 1}/${fileElements.length}: ${rawFilename}`);
                statusCallback(`Extracting ${i + 1}/${fileElements.length}: ${rawFilename.substring(0, 30)}...`);

                // Scroll element into view and click
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(resolve => setTimeout(resolve, 300));

                // Click the element
                element.click();

                // Wait for modal
                console.log('[Extractor] Waiting for modal...');
                const modal = await waitForModal(7000);

                if (!modal) {
                    console.log('[Extractor] No modal appeared, skipping...');
                    continue;
                }

                // Wait a bit more for content to fully load
                await new Promise(resolve => setTimeout(resolve, 500));

                // Extract content
                const content = extractContentFromModal(modal);

                if (content.length < 10) {
                    console.log('[Extractor] Content too short, skipping...');
                    await closeModal();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }

                // Determine file type and create clean filename
                const fileType = detectFileType(rawFilename, content);
                let cleanFilename = rawFilename
                    .replace(/\s*\d+\s*lines?\s*$/i, '')  // Remove trailing "X lines"
                    .replace(/[<>:"/\\|?*]/g, '_')        // Remove invalid chars
                    .replace(/\s+/g, '_')
                    .replace(/_+/g, '_')
                    .trim();

                // Add extension if not present
                if (!cleanFilename.match(/\.[a-zA-Z0-9]{1,5}$/)) {
                    cleanFilename += '.' + fileType;
                }

                console.log(`[Extractor] Extracted ${content.length} chars -> ${cleanFilename}`);

                files.push({
                    filename: cleanFilename,
                    content: content,
                    originalName: rawFilename
                });

                // Close modal
                await closeModal();
                await new Promise(resolve => setTimeout(resolve, 800));

            } catch (error) {
                console.error(`[Extractor] Error processing file:`, error);
                await closeModal();
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        console.log(`[Extractor] Successfully extracted ${files.length} files`);
        return files;
    }

    // Create and download ZIP
    async function createZIP(files, projectName) {
        console.log('[Extractor] Creating ZIP...');

        if (typeof JSZip === 'undefined') {
            console.error('[Extractor] JSZip not available!');
            throw new Error('JSZip library not loaded. Please reinstall the script.');
        }

        const zip = new JSZip();

        // Add each file
        const usedNames = new Set();
        files.forEach((file, index) => {
            let filename = file.filename;

            // Handle duplicate filenames
            if (usedNames.has(filename)) {
                const parts = filename.split('.');
                const ext = parts.pop();
                filename = `${parts.join('.')}_${index}.${ext}`;
            }
            usedNames.add(filename);

            console.log(`[Extractor] Adding: ${filename}`);
            zip.file(filename, file.content);
        });

        // Add metadata
        const metadata = {
            exportDate: new Date().toISOString(),
            projectTitle: projectName,
            url: window.location.href,
            fileCount: files.length,
            files: files.map(f => ({
                filename: f.filename,
                originalName: f.originalName,
                size: f.content.length
            }))
        };

        zip.file('_export_metadata.json', JSON.stringify(metadata, null, 2));

        // Generate ZIP
        console.log('[Extractor] Generating ZIP blob...');
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        console.log(`[Extractor] ZIP created: ${zipBlob.size} bytes`);

        // Download
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 16);
        const safeProjectName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const filename = `${safeProjectName}_${timestamp}.zip`;

        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`[Extractor] Downloaded: ${filename}`);
        return true;
    }

    // Download individual files as fallback
    function downloadIndividualFiles(files) {
        console.log('[Extractor] Downloading individual files...');

        files.forEach((file, index) => {
            setTimeout(() => {
                const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = file.filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                console.log(`[Extractor] Downloaded: ${file.filename}`);
            }, index * 500);
        });
    }

    // Get project title
    function getProjectTitle() {
        // Try specific selectors for Claude's UI
        const selectors = [
            '[data-testid="project-title"]',
            '[class*="project"] h1',
            '[class*="project"] h2',
            'h1',
            '.text-xl',
            '.text-2xl'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            const text = element?.textContent?.trim();
            if (text && text.length > 2 && text.length < 100 && text !== 'Claude') {
                return text;
            }
        }

        // Extract from URL
        const urlMatch = window.location.pathname.match(/project\/([^\/]+)/);
        if (urlMatch) {
            return decodeURIComponent(urlMatch[1]).replace(/[-_]/g, ' ');
        }

        return 'Claude_Project';
    }

    // Main export function
    async function exportProject() {
        const button = document.querySelector('#claude-export-btn');
        if (!button) return;

        const originalText = button.textContent;
        let isRunning = true;

        const updateStatus = (msg) => {
            if (isRunning && button) {
                button.textContent = msg;
            }
            console.log(`[Extractor] ${msg}`);
        };

        try {
            button.disabled = true;
            button.style.opacity = '0.8';

            updateStatus('Scanning...');
            const files = await extractProjectFiles(updateStatus);

            if (files.length === 0) {
                updateStatus('No files found!');
                alert('No project files found.\n\nMake sure you are on a Claude project page with knowledge files.\n\nTry scrolling through the project files list first to ensure they are loaded.');
                return;
            }

            const projectName = getProjectTitle();
            updateStatus(`Creating ZIP (${files.length} files)...`);

            try {
                await createZIP(files, projectName);
                updateStatus(`Done! ${files.length} files`);
            } catch (zipError) {
                console.error('[Extractor] ZIP failed:', zipError);
                updateStatus('ZIP failed, downloading individually...');
                downloadIndividualFiles(files);
            }

        } catch (error) {
            console.error('[Extractor] Export failed:', error);
            updateStatus('Export failed!');
            alert(`Export failed: ${error.message}`);
        } finally {
            isRunning = false;
            button.disabled = false;
            button.style.opacity = '1';
            setTimeout(() => {
                if (button) button.textContent = originalText;
            }, 3000);
        }
    }

    // Add export button
    function addExportButton() {
        // Remove existing button if present
        document.querySelector('#claude-export-btn')?.remove();

        const button = document.createElement('button');
        button.id = 'claude-export-btn';
        button.textContent = 'Export Project Files';
        button.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            z-index: 10000;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: all 0.2s ease;
            min-width: 180px;
            text-align: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        button.addEventListener('mouseenter', () => {
            button.style.transform = 'translateY(-2px)';
            button.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.transform = 'translateY(0)';
            button.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
        });

        button.addEventListener('click', exportProject);
        document.body.appendChild(button);

        console.log('[Extractor] Export button added');
    }

    // Initialize
    function init() {
        console.log('[Extractor] Claude Project Files Extractor v4.0 loaded');

        // Verify JSZip is available
        if (typeof JSZip === 'undefined') {
            console.error('[Extractor] JSZip not loaded! Script may not work correctly.');
        } else {
            console.log('[Extractor] JSZip loaded successfully');
        }

        // Add button when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', addExportButton);
        } else {
            addExportButton();
        }

        // Re-add button on SPA navigation
        let currentUrl = location.href;
        const observer = new MutationObserver(() => {
            if (location.href !== currentUrl) {
                currentUrl = location.href;
                setTimeout(addExportButton, 1000);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    init();
})();
