// ==UserScript==
// @name         cPanel Terminal Right Column
// @namespace    https://github.com/krkn-s
// @version      2026.11.11.1
// @description  Stretches the cPanel Terminal panel over the right column of the page, below the page description.
// @author       krkn-s
// @homepage     https://github.com/krkn-s/userscripts
// @homepageURL  https://github.com/krkn-s/userscripts
// @supportURL   https://github.com/krkn-s/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/cpanel-terminal-right-column.user.js
// @updateURL    https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/cpanel-terminal-right-column.user.js
// @match        *://*.o2switch.net/*/frontend/*/terminal/*
// @run-at       document-end
// @grant        none
// @license      MIT
// ==/UserScript==

/**
 * cPanel Terminal Right Column
 * ----------------------------
 * cPanel's Terminal app renders its xterm panel inside a narrow box. This
 * script keeps the terminal the page already provides and moves the existing
 * `.cp-terminal` panel over the right column: fixed position, 10 px margins,
 * top aligned under the page description, left aligned with the content area.
 *
 * The offsets come from `#content` and `.body-content > .description` and are
 * written to the `--tf-top` and `--tf-left` custom properties the stylesheet
 * reads. A `resize` event follows each placement so xterm's fit addon reflows
 * the rows to the new width. The script only lays the terminal out: it never
 * creates it, so a page without `.cp-terminal` is left untouched.
 */

(function () {
  'use strict';
  const M = 10;

  const style = document.createElement('style');
  style.textContent = `
    .cp-terminal {
      position: fixed !important;
      top: var(--tf-top, 150px) !important;
      left: var(--tf-left, 300px) !important;
      right: ${M}px !important;
      bottom: ${M}px !important;
      z-index: 100 !important;
      background: #faf8f2 !important;
      display: flex !important;
      flex-direction: column !important;
    }
    .cp-terminal .terminal-container {
      flex: 1 1 auto !important;
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
      max-width: none !important;
      min-height: 0 !important;
      margin: 0 !important;
    }
    .cp-terminal .terminal-xterm {
      flex: 1 1 auto !important;
      width: 100% !important;
      min-height: 0 !important;
    }
  `;
  document.documentElement.appendChild(style);

  const place = () => {
    const c = document.getElementById('content');
    const d = document.querySelector('.body-content > .description');
    if (!c || !d) return;
    const rc = c.getBoundingClientRect();
    const rd = d.getBoundingClientRect();
    const root = document.documentElement.style;
    root.setProperty('--tf-top', (rd.bottom + M) + 'px');
    root.setProperty('--tf-left', (Math.max(rc.left, 0) + M) + 'px');
    window.dispatchEvent(new Event('resize'));
  };

  let tries = 0;
  const timer = setInterval(() => {
    if (document.querySelector('.cp-terminal')) {
      place();
      if (++tries > 6) clearInterval(timer);
    }
  }, 400);

  window.addEventListener('load', () => setTimeout(place, 500));
})();
