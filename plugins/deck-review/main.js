// Deck Review — révision de flashcards par decks pour Noteriv.
// v0.2 : panneau latéral, decks = (fichier, section ##), filtres texte,
// sélection de decks, session de révision SM-2.
// JS pur, évalué par Function() : pas d'import/export, pas de JSX.
// IMPORTANT : toute l'API api.vault.* est ASYNCHRONE (Promises).

var __cleanup = function () {};

module.exports = {
  onLoad: function (api) {
    var PLUGIN = "deck-review";
    var REVIEWS_PATH = ".noteriv/flashcard-reviews.json";
    var STATE_PATH = ".noteriv/deck-review-state.json";
    var timers = [];
    var listeners = [];

    // ---------- utilitaires ----------

    function todayISO() {
      var d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    // debounce : un seul timer vivant par instance (on annule le précédent),
    // et on l'enregistre dans `timers` pour que onUnload puisse le défaire.
    function debounce(fn, ms) {
      var t = null;
      function wrapped() {
        var self = this, args = arguments;
        if (t) { clearTimeout(t); var i = timers.indexOf(t); if (i !== -1) timers.splice(i, 1); }
        t = setTimeout(function () {
          t = null;
          var j = timers.indexOf(h); if (j !== -1) timers.splice(j, 1);
          fn.apply(self, args);
        }, ms);
        var h = t;
        timers.push(t);
      }
      wrapped.cancel = function () {
        if (t) { clearTimeout(t); var i = timers.indexOf(t); if (i !== -1) timers.splice(i, 1); t = null; }
      };
      return wrapped;
    }

    // Même schéma d'id que Noteriv natif (desktop/src/lib/flashcard-utils.ts,
    // hashCard) : "fc-" + |hash31("source:texte")| en base 36. Indispensable
    // pour que la progression soit PARTAGÉE avec la révision native ⌘⌥F au
    // lieu de vivre dans un namespace parallèle.
    function hashCard(text, source) {
      var hash = 0;
      var str = source + ":" + text;
      for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
      }
      return "fc-" + Math.abs(hash).toString(36);
    }

    // ---------- accès vault (async) ----------

    function readText(path) {
      return api.vault.read(path).then(function (c) { return c || null; });
    }

    function readJSON(path, fallback) {
      return api.vault.exists(path).then(function (ex) {
        if (!ex) return fallback;
        return readText(path).then(function (raw) {
          try { return JSON.parse(raw) || fallback; } catch (e) { return fallback; }
        });
      });
    }

    function writeJSON(path, obj) {
      return api.vault.write(path, JSON.stringify(obj, null, 2));
    }

    // ---------- extraction des cartes ----------

    function parseFrontmatter(lines) {
      var fm = { title: null, created: null, tags: [] };
      if (lines.length && lines[0].trim() === "---") {
        for (var i = 1; i < lines.length; i++) {
          if (lines[i].trim() === "---") break;
          var m = lines[i].match(/^([A-Za-z]+):\s*(.*)$/);
          if (!m) continue;
          var k = m[1].toLowerCase(), v = m[2].trim();
          if (k === "title") fm.title = v.replace(/^["']|["']$/g, "");
          else if (k === "created") fm.created = v;
          else if (k === "tags") {
            var inner = v.replace(/^\[|\]$/g, "");
            fm.tags = inner.split(",").map(function (s) { return s.trim().replace(/^#/, ""); }).filter(Boolean);
          }
        }
      }
      return fm;
    }

    function extractCards(filePath, content) {
      var lines = content.split(/\r?\n/);
      var fm = parseFrontmatter(lines);
      var title = fm.title || filePath.replace(/\.md$/, "").split("/").pop();
      var cards = [];
      var deck = "(sans section)";
      var pendingQ = null;
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var h = ln.match(/^#{1,6}\s+(.*)/);
        if (h) { deck = h[1].trim(); continue; }
        // Règle d'extraction alignée sur Noteriv natif : le "A:" doit suivre
        // IMMÉDIATEMENT le "Q:" (pas de ligne vide, pas de "→" entre les deux).
        // Sinon le natif ne voit pas la carte et l'id n'aurait pas de pendant.
        var qm = ln.match(/^Q:\s*(.+)/i);
        if (qm) { pendingQ = qm[1].trim(); continue; }
        var am = pendingQ !== null ? ln.match(/^A:\s*(.+)/i) : null;
        if (am) {
          var id = hashCard(pendingQ, filePath);
          var tagsInCard = ((pendingQ + " " + am[1]).match(/#([\p{L}\p{N}_-]+)/gu) || [])
            .map(function (t) { return t.slice(1); });
          cards.push({
            id: id, file: filePath, deck: deck, title: title,
            created: fm.created, tags: fm.tags.concat(tagsInCard),
            q: pendingQ, a: am[1].trim()
          });
          pendingQ = null;
        }
      }
      return cards;
    }

    function listMarkdownFiles(dir, acc) {
      acc = acc || [];
      return api.vault.list(dir || "").then(function (entries) {
        var chain = Promise.resolve();
        entries.forEach(function (e) {
          if (e.name === ".git" || e.name === ".noteriv") return;
          var p = dir ? dir + "/" + e.name : e.name;
          if (e.isDir) {
            chain = chain.then(function () { return listMarkdownFiles(p, acc); });
          } else if (/\.md$/i.test(e.name)) {
            acc.push(p);
          }
        });
        return chain.then(function () { return acc; });
      });
    }

    function scanVault() {
      return listMarkdownFiles("").then(function (files) {
        var cards = [];
        var chain = Promise.resolve();
        files.forEach(function (f) {
          chain = chain.then(function () {
            return readText(f).then(function (content) {
              if (!content) return;
              var cs = extractCards(f, content);
              for (var j = 0; j < cs.length; j++) cards.push(cs[j]);
            });
          });
        });
        return chain.then(function () { return cards; });
      });
    }

    function buildDecks(cards, reviews) {
      var today = todayISO();
      var decks = {};
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var key = c.file + " › " + c.deck;
        if (!decks[key]) decks[key] = { key: key, file: c.file, deck: c.deck, cards: [], due: 0 };
        var r = reviews[c.id];
        c.due = !r || (r.nextReview || "9999") <= today;
        if (c.due) decks[key].due++;
        decks[key].cards.push(c);
      }
      var arr = Object.keys(decks).map(function (k) { return decks[k]; });
      arr.sort(function (a, b) { return b.due - a.due || a.key.localeCompare(b.key); });
      return arr;
    }

    // ---------- état persistant ----------

    function loadState() {
      return readJSON(STATE_PATH, {}).then(function (s) {
        if (!s.selected) s.selected = {};
        if (!s.filter) s.filter = "";
        return s;
      });
    }

    // ---------- panneau latéral ----------

    var currentEl = null;

    var panelId = PLUGIN + "-panel";
    function registerPanel() {
      api.ui.addSidebarPanel({
        id: panelId,
        title: "Decks",
        icon: "🂠",
        render: function (el) { currentEl = el; refresh(); }
      });
    }
    registerPanel();

    // Garde de génération : seul le refresh le plus récent a le droit de
    // peindre. Un scan lent démarré avant un scan rapide ne doit pas écraser
    // l'affichage avec un état périmé à son retour.
    var refreshGen = 0;

    function refresh() {
      var gen = ++refreshGen;
      Promise.all([loadState(), scanVault(), readJSON(REVIEWS_PATH, {})]).then(function (res) {
        if (gen !== refreshGen) return; // une génération plus récente est en vol
        updateStatusBar(buildDecks(res[1], res[2]));
        if (currentEl) renderPanel(currentEl, res[0], res[1], res[2]);
      }).catch(function (e) {
        if (gen !== refreshGen) return;
        try { console.error("[deck-review] refresh échoué:", e && e.message); } catch (_) {}
      });
    }

    function renderPanel(el, state, cards, reviews) {
      var decks = buildDecks(cards, reviews);

      el.innerHTML = "";
      var style = document.createElement("style");
      style.textContent = [
        ".dr-wrap{padding:8px;font:13px/1.4 sans-serif}",
        ".dr-filter{width:100%;box-sizing:border-box;margin-bottom:6px;padding:4px 6px}",
        ".dr-deck{display:flex;align-items:center;gap:6px;padding:3px 2px;border-bottom:1px solid rgba(128,128,128,.2)}",
        ".dr-count{margin-left:auto;color:#888;font-size:12px;white-space:nowrap}",
        ".dr-btn{margin:8px 0 4px;padding:6px 10px;cursor:pointer}",
        ".dr-card-q{font-size:15px;margin:12px 0}",
        ".dr-card-a{color:#888;margin:8px 0}",
        ".dr-grades button{margin:0 6px 6px 0;padding:5px 9px;cursor:pointer}"
      ].join("\n");
      el.appendChild(style);

      var wrap = document.createElement("div");
      wrap.className = "dr-wrap";

      if (state.session && state.session.active) {
        renderSession(wrap, state, cards, reviews);
        el.appendChild(wrap);
        return;
      }

      var filter = document.createElement("input");
      filter.className = "dr-filter";
      filter.placeholder = "Filtrer (titre, tag, mot de la carte)…";
      filter.value = state.filter;
      filter.addEventListener("input", debounce(function () {
        state.filter = filter.value;
        writeJSON(STATE_PATH, state).then(refresh);
      }, 300));
      wrap.appendChild(filter);

      var f = state.filter.trim().toLowerCase();
      var shown = decks.filter(function (d) {
        if (!f) return true;
        if (d.key.toLowerCase().indexOf(f) !== -1) return true;
        for (var i = 0; i < d.cards.length; i++) {
          var c = d.cards[i];
          var hay = (c.title + " " + c.tags.join(" ") + " " + c.q + " " + c.a).toLowerCase();
          if (hay.indexOf(f) !== -1) return true;
        }
        return false;
      });

      var totalDue = 0, totalSel = 0;
      shown.forEach(function (d) {
        totalDue += d.due;
        if (state.selected[d.key]) totalSel += d.due;
      });

      shown.forEach(function (d) {
        var row = document.createElement("label");
        row.className = "dr-deck";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!state.selected[d.key];
        cb.addEventListener("change", function () {
          if (cb.checked) state.selected[d.key] = true; else delete state.selected[d.key];
          writeJSON(STATE_PATH, state).then(refresh);
        });
        var label = document.createElement("span");
        label.textContent = d.deck + "  (" + d.file + ")";
        var cnt = document.createElement("span");
        cnt.className = "dr-count";
        cnt.textContent = d.due + "/" + d.cards.length + " dues";
        row.appendChild(cb); row.appendChild(label); row.appendChild(cnt);
        wrap.appendChild(row);
      });

      var btn = document.createElement("button");
      btn.className = "dr-btn";
      btn.textContent = "Réviser la sélection (" + totalSel + " cartes dues)";
      btn.disabled = totalSel === 0;
      btn.addEventListener("click", function () { startSession(state, decks); });
      wrap.appendChild(btn);

      var hint = document.createElement("div");
      hint.style.cssText = "color:#888;font-size:11px;margin-top:6px";
      hint.textContent = totalDue + " cartes dues au total · " + shown.length + " decks affichés";
      wrap.appendChild(hint);

      el.appendChild(wrap);
    }

    function startSession(state, decks) {
      var queue = [];
      decks.forEach(function (d) {
        if (!state.selected[d.key]) return;
        d.cards.forEach(function (c) { if (c.due) queue.push(c); });
      });
      for (var i = queue.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = queue[i]; queue[i] = queue[j]; queue[j] = tmp;
      }
      state.session = { active: true, queue: queue.map(function (c) { return c.id; }), index: 0, showAnswer: false };
      writeJSON(STATE_PATH, state).then(refresh);
    }

    function renderSession(wrap, state, cards, reviews) {
      var byId = {};
      cards.forEach(function (c) { byId[c.id] = c; });
      var sess = state.session;
      var card = byId[sess.queue[sess.index]];
      if (!card) { state.session = null; writeJSON(STATE_PATH, state).then(refresh); return; }

      var head = document.createElement("div");
      head.style.cssText = "color:#888;font-size:12px;margin-bottom:4px";
      head.textContent = "Carte " + (sess.index + 1) + "/" + sess.queue.length + " — " + card.deck;
      wrap.appendChild(head);

      var q = document.createElement("div");
      q.className = "dr-card-q";
      q.textContent = card.q;
      wrap.appendChild(q);

      if (sess.showAnswer) {
        var a = document.createElement("div");
        a.className = "dr-card-a";
        a.textContent = card.a;
        wrap.appendChild(a);
      }

      var bar = document.createElement("div");
      bar.className = "dr-grades";
      if (!sess.showAnswer) {
        bar.appendChild(mkBtn("Voir la réponse", function () {
          sess.showAnswer = true;
          writeJSON(STATE_PATH, state).then(refresh);
        }));
      } else {
        [["Encore", 1], ["Difficile", 3], ["OK", 4], ["Facile", 5]].forEach(function (g) {
          bar.appendChild(mkBtn(g[0], function () { grade(state, card, g[1]); }));
        });
      }
      var quit = mkBtn("Quitter", function () {
        state.session = null;
        writeJSON(STATE_PATH, state).then(refresh);
      });
      bar.appendChild(quit);
      wrap.appendChild(bar);
    }

    function mkBtn(text, fn) {
      var b = document.createElement("button");
      b.textContent = text;
      b.addEventListener("click", fn);
      return b;
    }

    // SM-2 : on écrit dans le même fichier que Noteriv pour rester compatible
    function grade(state, card, gradeVal) {
      readJSON(REVIEWS_PATH, {}).then(function (reviews) {
        var r = reviews[card.id] || { ease: 2.5, interval: 0, repetitions: 0 };
        if (gradeVal <= 1) { r.repetitions = 0; r.interval = 1; }
        else {
          r.repetitions++;
          if (r.repetitions === 1) r.interval = 1;
          else if (r.repetitions === 2) r.interval = 6;
          else r.interval = Math.round(r.interval * r.ease);
          r.ease = Math.max(1.3, r.ease + (0.1 - (5 - gradeVal) * (0.08 + (5 - gradeVal) * 0.02)));
        }
        var d = new Date();
        d.setDate(d.getDate() + r.interval);
        r.nextReview = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        r.lastReview = todayISO();
        r.cardId = card.id;
        reviews[card.id] = r;
        return writeJSON(REVIEWS_PATH, reviews).then(function () {
          state.session.index++;
          if (state.session.index >= state.session.queue.length) state.session = null;
          else state.session.showAnswer = false;
          writeJSON(STATE_PATH, state).then(refresh);
        });
      });
    }

    // ---------- barre de statut (complément du panneau) ----------

    var STATUS_ID = PLUGIN + "-status";
    var lastStatusText = null;

    function updateStatusBar(decks) {
      var due = 0;
      decks.forEach(function (d) { due += d.due; });
      var text = "🂠" + due;
      if (text !== lastStatusText) {
        lastStatusText = text;
        try { api.ui.removeStatusBarItem(STATUS_ID); } catch (e) {}
        api.ui.addStatusBarItem({
          id: STATUS_ID,
          text: text,
          title: due + " carte(s) due(s) — cliquer pour rafraîchir le panneau Decks",
          onClick: function () { refresh(); }
        });
      }
    }

    // ---------- commande ----------

    api.ui.addCommand({
      id: PLUGIN + "-open",
      name: "Decks : ouvrir le panneau de révision",
      callback: function () {
        // Le panneau s'ouvre par le bouton du ribbon ; la commande rafraîchit
        // les données et rappelle où le trouver.
        refresh();
        api.ui.showNotice("Panneau « Decks » : icône 🂠 dans la barre latérale.");
      }
    });

    // rescan au changement de vault
    var onVaultChange = debounce(refresh, 500);
    api.events.on("vault-change", onVaultChange);
    listeners.push(["vault-change", onVaultChange]);

    // statut initial au chargement
    refresh();

    // Nettoyage exposé à onUnload : timers armés, debounce en vol, listeners.
    __cleanup = function () {
      for (var i = 0; i < timers.length; i++) { try { clearTimeout(timers[i]); } catch (e) {} }
      timers.length = 0;
      if (onVaultChange && onVaultChange.cancel) onVaultChange.cancel();
      // Les listeners sont retirés par Noteriv lui-même à l'unload (il tient la
      // table des handlers par préfixe de plugin) : on ne rappelle pas off(),
      // qui supprimerait aussi les handlers homonymes des AUTRES plug-ins.
      listeners.length = 0;
      currentEl = null;
    };
  },

  onUnload: function () {
    // Les enregistrements UI (panneau, statut, commande) sont auto-nettoyés
    // par Noteriv ; les timers et listeners, non : on les défait ici.
    try { __cleanup(); } catch (e) {}
  }
};
