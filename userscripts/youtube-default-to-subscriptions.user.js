// ==UserScript==
// @name         YouTube.com — Default to My Subscriptions
// @namespace    https://github.com/krkn-s
// @version      1.1
// @description  Redirects signed-in YouTube home visits to the Subscriptions page.
// @author       https://github.com/krkn-s
// @homepageURL  https://github.com/krkn-s/userscripts
// @supportURL   https://github.com/krkn-s/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-default-to-subscriptions.user.js
// @updateURL    https://raw.githubusercontent.com/krkn-s/userscripts/main/userscripts/youtube-default-to-subscriptions.user.js
// @match        *://*.youtube.com/*
// @include      *://*.youtube.com/*
// @exclude      *://*.youtube.com/feed/*
// @exclude      *://*.youtube.com/watch*
// @exclude      *://*.youtube.com/channel/*
// @exclude      *://*.youtube.com/user/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const subscriptionsPathPattern = /\/feed\/subscriptions/;
  const isSignedIn = document.cookie.includes("SID");
  const isHomePage = window.location.pathname === "/" || window.location.pathname === "";
  const cameFromSubscriptions = subscriptionsPathPattern.test(document.referrer);

  if (isSignedIn && isHomePage && !cameFromSubscriptions) {
    window.location.pathname = "/feed/subscriptions";
  }
})();
