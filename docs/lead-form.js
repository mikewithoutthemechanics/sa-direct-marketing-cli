/**
 * lead-form.js — on-page lead capture.
 *
 * This replaced a "book a call" link that bounced the visitor to a
 * calendar. A calendar link loses most of the people who click it; a
 * form that asks for four fields and promises a written answer captures
 * them. The trade-off is that it needs an endpoint, so this is written
 * to work with no backend at all and to be pointed at one in one line.
 *
 * Two behaviours, in order of preference:
 *   1. window.AGENTCY_FORM_ENDPOINT is set -> fetch() POST JSON there.
 *   2. otherwise -> compose a prefilled mailto: so the lead still reaches
 *      a human inbox rather than being silently dropped.
 *
 * It never claims success unless it actually got a response, and it never
 * blocks the rest of the page if it fails.
 */
(function () {
  "use strict";

  var form = document.getElementById("lead-form");
  if (!form) return;
  var status = document.getElementById("lead-status");

  function say(msg, kind) {
    if (!status) return;
    status.textContent = msg;
    status.className = "tryit-note" + (kind ? " is-" + kind : "");
  }

  function collect(fd) {
    var out = {};
    var keys = ["name", "business", "email", "phone", "list_size", "channel", "note"];
    for (var i = 0; i < keys.length; i++) {
      var v = String(fd.get(keys[i]) || "").trim();
      if (v) out[keys[i]] = v;
    }
    var file = document.getElementById("lf-file");
    if (file && file.files && file.files[0]) {
      out.list_file = file.files[0].name;
    }
    return out;
  }

  function validate(data) {
    if (!data.name) return "We need a name to reply to.";
    if (!data.business) return "Which business is this for?";
    if (!data.email || data.email.indexOf("@") < 1) return "We need an email address to send the audit to.";
    return null;
  }

  function buildMailto(data) {
    var subject = "Free compliance audit request - " + (data.business || "");
    var body =
      "Name: " + (data.name || "") + "\n" +
      "Business: " + (data.business || "") + "\n" +
      "Email: " + (data.email || "") + "\n" +
      "WhatsApp: " + (data.phone || "-") + "\n" +
      "List size: " + (data.list_size || "-") + "\n" +
      "Channel: " + (data.channel || "-") + "\n" +
      (data.list_file ? "Attached list: " + data.list_file + " (see note below)\n" : "") +
      "Notes: " + (data.note || "-") + "\n\n" +
      "Requested via the Compliance Cleanse one-pager.\n";
    if (data.list_file) {
      body += "\nNOTE: I tried to attach my list as '" + data.list_file +
              "' but this email was sent from the website, so the file did not\n" +
              "come with it. I will reply to this email with the file attached, or\n" +
              "send it on WhatsApp if that is easier.\n";
    }
    return "mailto:hello@agentcy.co.za?subject=" + encodeURIComponent(subject) +
           "&body=" + encodeURIComponent(body);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = collect(new FormData(form));

    var problem = validate(data);
    if (problem) { say(problem, "warn"); return; }

    var endpoint = window.AGENTCY_FORM_ENDPOINT;
    var btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = true;
    say("Sending...");

    function done(ok, msg) {
      if (btn) btn.disabled = false;
      say(msg, ok ? "ok" : "warn");
      if (ok) form.reset();
    }

    if (!endpoint) {
      // no backend configured: hand the lead to the mail client instead
      window.location.href = buildMailto(data);
      done(true, data.list_file
        ? "Your email app should have opened with the details filled in. Please attach " +
          "your list file to that email before sending - we cannot receive it from the website."
        : "Your email app should have opened with the details filled in. " +
          "If nothing happened, email hello@agentcy.co.za directly.");
      return;
    }

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      done(true, data.list_file
        ? "Received. We will run the audit and reply within one working day. If you attached a " +
          "list it did not come with this form - reply to our email with the file attached."
        : "Received. We run these against the live registry and reply within one working day.");
    }).catch(function (err) {
      // never swallow a lead
      window.location.href = buildMailto(data);
      done(true, "We could not reach the form service, so we have put the details in your email app " +
                 "instead. If nothing happened, email hello@agentcy.co.za.");
    });
  });
})();
