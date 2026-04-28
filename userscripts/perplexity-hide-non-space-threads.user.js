// ==UserScript==
// @name         Perplexity Library - Hide Space Threads
// @namespace    https://github.com/krkn-s
// @version      2026.04.28.1
// @description  Adds a Library button to hide Perplexity threads that are in a custom Space.
// @author       https://github.com/krkn-s
// @homepageURL  https://github.com/krkn-s/userscripts
// @supportURL   https://github.com/krkn-s/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/perplexity-hide-non-space-threads.user.js
// @updateURL    https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/perplexity-hide-non-space-threads.user.js
// @match        https://www.perplexity.ai/library*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const IDS = {
    button: "pplx-space-filter-toggle",
    style: "pplx-space-filter-style",
  };

  const CLASS_HIDDEN = "pplx-space-filter-hidden";
  const STATE = {
    enabled: false,
    applyScheduled: false,
    visible: 0,
    hidden: 0,
  };

  function isLibraryPage() {
    return window.location.pathname === "/library" || window.location.pathname.startsWith("/library/");
  }

  function injectStyle() {
    if (document.getElementById(IDS.style)) return;

    const style = document.createElement("style");
    style.id = IDS.style;
    style.textContent = `
      .${CLASS_HIDDEN} {
        display: none !important;
      }

      #${IDS.button} {
        align-items: center;
        background: transparent;
        border: 1px solid color-mix(in oklch, currentColor 18%, transparent);
        border-radius: 6px;
        color: inherit;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        height: 24px;
        line-height: 1;
        padding: 0 8px;
        white-space: nowrap;
      }

      #${IDS.button}:hover {
        background: color-mix(in oklch, currentColor 8%, transparent);
      }

      #${IDS.button}[aria-pressed="true"] {
        background: color-mix(in oklch, currentColor 12%, transparent);
        border-color: color-mix(in oklch, currentColor 32%, transparent);
      }

      #${IDS.button}.pplx-space-filter-floating {
        bottom: 16px;
        box-shadow: 0 4px 18px rgb(0 0 0 / 0.12);
        position: fixed;
        right: 16px;
        z-index: 10000;
      }
    `;
    document.head.appendChild(style);
  }

  function getThreadsPanel() {
    return (
      document.querySelector('[role="tabpanel"][aria-labelledby$="trigger-threads"]') ||
      document.querySelector('[id$="content-threads"]') ||
      document
    );
  }

  function getThreadRowFromSearchLink(link) {
    const dividedParent = closestByPredicate(link, (node) => {
      return Array.from(node.parentElement?.classList || []).includes("divide-y");
    });
    if (dividedParent) return dividedParent;

    return closestByPredicate(link, (node) => {
      return Boolean(node.querySelector('button[aria-label="Thread actions"]'));
    });
  }

  function closestByPredicate(start, predicate) {
    let node = start;
    const panel = getThreadsPanel();

    while (node && node !== document.body && node !== panel.parentElement) {
      if (node instanceof HTMLElement && predicate(node)) return node;
      node = node.parentElement;
    }

    return null;
  }

  function getThreadRows() {
    const panel = getThreadsPanel();
    const rows = new Set();

    panel.querySelectorAll('a[href^="/search/"]').forEach((link) => {
      const row = getThreadRowFromSearchLink(link);
      if (row) rows.add(row);
    });

    return Array.from(rows);
  }

  function hasSpace(row) {
    return Boolean(row.querySelector('a[href^="/spaces/"]'));
  }

  function applyFilter() {
    if (STATE.applyScheduled) return;
    STATE.applyScheduled = true;

    window.requestAnimationFrame(() => {
      let visible = 0;
      let hidden = 0;

      if (!STATE.enabled) clearHiddenRows();

      getThreadRows().forEach((row) => {
        const shouldHide = STATE.enabled && hasSpace(row);
        row.classList.toggle(CLASS_HIDDEN, shouldHide);

        if (shouldHide) hidden += 1;
        else visible += 1;
      });

      STATE.visible = visible;
      STATE.hidden = hidden;
      updateButton();
      STATE.applyScheduled = false;
    });
  }

  function updateButton() {
    const button = document.getElementById(IDS.button);
    if (!button) return;

    button.textContent = STATE.enabled ? "Show spaces" : "Hide spaces";
    button.setAttribute("aria-pressed", String(STATE.enabled));
    button.title = STATE.enabled
      ? `Filter active. Spaces and Bookmarks hidden. Visible: ${STATE.visible} / Hidden: ${STATE.hidden}`
      : "Hide threads attached to a Space or Bookmarks";
  }

  function getFilterBar() {
    const panel = getThreadsPanel();
    const selectButton = panel.querySelector('button[aria-label="Select"]');
    return selectButton?.closest(".gap-sm.flex.items-center") || null;
  }

  function ensureButton() {
    if (!isLibraryPage()) {
      removeButton();
      clearHiddenRows();
      return;
    }

    injectStyle();

    let button = document.getElementById(IDS.button);
    if (!button) {
      button = document.createElement("button");
      button.id = IDS.button;
      button.type = "button";
      button.addEventListener("click", () => {
        STATE.enabled = !STATE.enabled;
        if (!STATE.enabled) clearHiddenRows();
        applyFilter();
      });
    }

    const filterBar = getFilterBar();
    if (filterBar) {
      button.classList.remove("pplx-space-filter-floating");
      if (button.parentElement !== filterBar) filterBar.appendChild(button);
    } else if (!button.isConnected) {
      button.classList.add("pplx-space-filter-floating");
      document.body.appendChild(button);
    }

    updateButton();
    applyFilter();
  }

  function removeButton() {
    document.getElementById(IDS.button)?.remove();
  }

  function clearHiddenRows() {
    document.querySelectorAll(`.${CLASS_HIDDEN}`).forEach((row) => {
      row.classList.remove(CLASS_HIDDEN);
    });
  }

  function watchLocationChanges() {
    let current = window.location.href;

    const check = () => {
      if (window.location.href === current) return;
      current = window.location.href;
      STATE.enabled = false;
      ensureButton();
    };

    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function () {
        const result = original.apply(this, arguments);
        window.setTimeout(check, 0);
        return result;
      };
    });

    window.addEventListener("popstate", check);
  }

  function start() {
    injectStyle();
    ensureButton();
    watchLocationChanges();

    const observer = new MutationObserver(() => {
      window.clearTimeout(observer.pending);
      observer.pending = window.setTimeout(ensureButton, 100);
    });

    observer.pending = 0;
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
