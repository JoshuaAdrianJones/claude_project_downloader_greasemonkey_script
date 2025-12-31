# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Greasemonkey/Tampermonkey userscript that adds an "Export Project Files" button to Claude.ai to download all project knowledge files.

## Development

No build system or tests. The entire script is `script.js`. To test: install in Tampermonkey, then visit a Claude project page.

## Architecture

Single IIFE in `script.js`:
- `findFiles()` - scans DOM for clickable elements with file indicators ("X lines" or file extensions)
- `exportProject()` - clicks each file, extracts content from modal, downloads as individual files
- `addButton()` - injects the export button, re-added on SPA navigation via MutationObserver
