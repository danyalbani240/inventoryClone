/*
  db.js — injected into every page by server.js.
  Your pages keep calling localStorage.getItem/setItem; for the keys below,
  the data now lives in the server's SQLite file instead of the browser.
*/
(function () {
  "use strict";

  var KEYS = [
    "inventory-manager-products-v1",
    "inventory-sales-log-v1",
    "inventory-invoices-v1",
    "inventory-usd-rate-v1",
    "shop-expenses-log-v1",
    "purchase-invoices-v1",
    "shop-receivables-v1",
    "shop-payables-v1",
    "daily-todo-manager-tasks-v1",
    "contacts-manager-v1",
  ];
  window.SHOP_KEYS = KEYS;

  var nativeGet = Storage.prototype.getItem;
  var mem = {};
  var ver = {};

  // ---------- status badge ----------
  var statusText = "";
  var statusBad = false;
  var badge = null;
  function paint() {
    if (!badge) return;
    badge.textContent = statusText;
    badge.style.background = statusBad ? "#dc2626" : "#111827";
    badge.style.display = statusText ? "block" : "none";
  }
  function setStatus(text, bad) {
    statusText = text;
    statusBad = !!bad;
    paint();
  }
  document.addEventListener("DOMContentLoaded", function () {
    badge = document.createElement("div");
    badge.className = "no-print";
    badge.style.cssText =
      "position:fixed;left:12px;bottom:12px;z-index:99999;color:#fff;padding:6px 12px;" +
      "border-radius:999px;font:600 12px system-ui,sans-serif;display:none;opacity:.92;max-width:80vw";
    document.body.appendChild(badge);
    paint();
  });

  function stop(message) {
    document.write('<p style="font:16px system-ui;padding:40px">' + message + "</p>");
    throw new Error(message);
  }

  // ---------- first load (blocking, so page scripts see the data) ----------
  var data = {};
  var x = new XMLHttpRequest();
  try {
    x.open("GET", "/api/all", false);
    x.send(null);
  } catch (e) {
    stop("Cannot reach the server. Is it running?");
  }
  if (x.status === 401) {
    location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
    stop("Redirecting to login…");
  }
  if (x.status !== 200) stop("Server error (" + x.status + ").");
  try {
    var parsed = JSON.parse(x.responseText);
    data = parsed.data;
    ver = parsed.ver;
  } catch (e) {
    stop("Unreadable reply from the server.");
  }

  // ---------- saving (background, one request per key at a time) ----------
  var pending = {};
  var busy = {};
  var inflight = 0;
  var timer = null;
  var conflict = false;

  function queue(k, v) {
    pending[k] = v;
    if (!conflict) setStatus("Saving…");
    clearTimeout(timer);
    timer = setTimeout(pump, 300);
  }
  function anyPending() {
    return Object.keys(pending).length > 0;
  }
  function pump() {
    Object.keys(pending).forEach(function (k) {
      if (busy[k]) return;
      var v = pending[k];
      delete pending[k];
      busy[k] = true;
      inflight++;
      send(k, v);
    });
  }
  function finish(k) {
    busy[k] = false;
    inflight--;
    if (anyPending()) return pump();
    if (!inflight && !conflict) {
      setStatus("Saved");
      setTimeout(function () {
        if (statusText === "Saved") setStatus("");
      }, 1500);
    }
  }
  function send(k, v) {
    fetch("/api/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ k: k, v: v, ver: ver[k] || 0 }),
    })
      .then(function (r) {
        if (r.status === 401) {
          location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
          return;
        }
        if (r.ok)
          return r.json().then(function (j) {
            ver[k] = j.ver;
            finish(k);
          });
        if (r.status === 409) {
          conflict = true;
          setStatus("Changed on another device or tab. Reload — your last change was NOT saved.", true);
          return finish(k);
        }
        throw new Error("HTTP " + r.status);
      })
      .catch(function () {
        if (!(k in pending)) pending[k] = v;
        busy[k] = false;
        inflight--;
        setStatus("Not saved — retrying…", true);
        clearTimeout(timer);
        timer = setTimeout(pump, 3000);
      });
  }
  window.addEventListener("beforeunload", function (e) {
    if (inflight || anyPending()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ---------- load values; push old browser data if the server has none ----------
  KEYS.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      mem[k] = data[k];
    } else {
      var local = nativeGet.call(localStorage, k);
      if (local !== null) {
        mem[k] = local;
        queue(k, local);
      }
    }
  });

  // ---------- patch localStorage for our keys only ----------
  var nativeSet = Storage.prototype.setItem;
  Storage.prototype.getItem = function (k) {
    if (this === localStorage && KEYS.indexOf(k) > -1)
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    return nativeGet.call(this, k);
  };
  Storage.prototype.setItem = function (k, v) {
    if (this === localStorage && KEYS.indexOf(k) > -1) {
      mem[k] = String(v);
      queue(k, mem[k]);
      return;
    }
    return nativeSet.call(this, k, v);
  };
})();
