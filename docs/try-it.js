/**
 * try-it.js — an interactive, entirely local demonstration of the cleanse.
 *
 * The visitor pastes any list they like. Nothing is uploaded, nothing
 * leaves the browser, and the cross-match runs on a small local blocklist
 * seeded with fictional numbers. The point is not real compliance data -
 * it is to let a sceptical prospect SEE the mechanic in ten seconds
 * instead of taking it on faith.
 *
 * If any part of this fails, the section simply stays in its pre-run
 * state. It never blocks the rest of the page.
 */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var root = $("#tryit");
  if (!root) return;

  var input = $("#tryit-input", root);
  var runBtn = $("#tryit-run", root);
  var resetBtn = $("#tryit-reset", root);
  var out = $("#tryit-out", root);
  var stage = $("#tryit-stage", root);
  var note = $("#tryit-note", root);

  // Fictional demo blocklist. These are NOT real numbers. They exist so
  // the visitor can watch the mechanic work end to end.
  var DEMO_BLOCKED = {
    "0825550101": true, "0713330202": true, "0837770303": true,
    "0614440404": true, "0746660505": true, "0798880606": true
  };
  var DEMO_ALLOWED = {
    "0821110001": true, "0722220002": true, "0833330003": true,
    "0644440004": true, "0755550005": true, "0766660006": true,
    "0777770007": true, "0818880008": true
  };

  function normalise(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    s = s.replace(/[\s\-().+]/g, "");
    if (s.startsWith("0027")) s = "0" + s.slice(4);
    if (s.startsWith("27") && s.length === 11) s = "0" + s.slice(2);
    return s;
  }

  function parseList(text) {
    var parts = String(text || "").split(/[\s,;\n\r\t]+/);
    var seen = {};
    var outRows = [];
    for (var i = 0; i < parts.length; i++) {
      var n = normalise(parts[i]);
      if (!n || n.length < 9) continue;
      if (seen[n]) continue;
      seen[n] = true;
      outRows.push(n);
      if (outRows.length >= 60) break;
    }
    return outRows;
  }

  function render(rows) {
    if (!out) return;
    out.innerHTML = "";

    var blocked = 0, cleared = 0;
    var list = document.createElement("div");
    list.className = "tryit-list";

    rows.forEach(function (n) {
      var isBlocked = !!DEMO_BLOCKED[n];
      var isKnown = isBlocked || !!DEMO_ALLOWED[n];
      if (isBlocked) blocked++; else if (isKnown) cleared++;

      var row = document.createElement("div");
      row.className = "tryit-row" + (isBlocked ? " is-blocked" : "") + (isKnown ? "" : " is-unknown");
      row.setAttribute("data-num", n);

      var num = document.createElement("span");
      num.className = "tryit-num";
      num.textContent = n;

      var tag = document.createElement("span");
      tag.className = "tryit-tag";
      tag.textContent = isBlocked ? "BLOCKED" : (isKnown ? "clear" : "not in demo list");

      row.appendChild(num);
      row.appendChild(tag);
      list.appendChild(row);
    });

    var summary = document.createElement("div");
    summary.className = "tryit-summary";
    summary.innerHTML =
      "<b>" + rows.length + "</b> checked &middot; " +
      "<b class='bad'>" + blocked + "</b> suppressed &middot; " +
      "<b>" + cleared + "</b> cleared";
    out.appendChild(summary);
    out.appendChild(list);
  }

  function run() {
    if (!input) return;
    var rows = parseList(input.value);
    if (!rows.length) {
      if (note) {
        note.textContent = "Add at least a few numbers or emails first — commas, spaces or one per line all work.";
        note.className = "tryit-note is-warn";
      }
      return;
    }
    if (note) { note.textContent = ""; note.className = "tryit-note"; }
    render(rows);

    // drive the gate with exactly these records so the picture and the
    // table agree - the visitor sees the same numbers land in both places
    if (window.TryGate) {
      try { window.TryGate.setRecords(rows, function (n) { return !!DEMO_BLOCKED[n]; }); }
      catch (e) { /* the picture is a bonus; the table is the answer */ }
    }
  }

  function seedDemo() {
    var sample = [
      "0821110001", "0825550101", "0722220002", "0833330003",
      "0713330202", "0644440004", "0837770303", "0755550005",
      "0614440404", "0766660006", "0798880606", "0818880008"
    ];
    if (input) input.value = sample.join(", ");
    run();
  }

  if (runBtn) runBtn.addEventListener("click", run);
  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      if (input) { input.value = ""; run(); }
    });
  }
  if (input) {
    input.addEventListener("input", function () {
      if (note && note.classList.contains("is-warn")) { note.textContent = ""; note.className = "tryit-note"; }
    });
  }

  // offer a sample so nobody faces an empty box
  var sampleBtn = $("#tryit-sample", root);
  if (sampleBtn) sampleBtn.addEventListener("click", seedDemo);

  // expose a hook the 3D engine can register into
  window.TryGate = null;
})();
