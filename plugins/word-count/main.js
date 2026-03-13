// Word Count Plugin for Noteriv
// Shows live word count, character count, and estimated reading time
// in the status bar. Adds a command for detailed stats.

var updateTimer = null;
var api = null;

function countStats(text) {
  if (!text) return { words: 0, chars: 0, charsNoSpaces: 0, lines: 0, sentences: 0, paragraphs: 0, readingTime: "0 min" };

  var trimmed = text.trim();
  var words = trimmed ? trimmed.split(/\s+/).length : 0;
  var chars = text.length;
  var charsNoSpaces = text.replace(/\s/g, "").length;
  var lines = text.split("\n").length;
  var sentences = trimmed ? (trimmed.match(/[.!?]+(\s|$)/g) || []).length : 0;
  var paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter(function(p) { return p.trim(); }).length : 0;

  // Average reading speed: 238 words per minute
  var minutes = Math.ceil(words / 238);
  var readingTime = minutes < 1 ? "< 1 min" : minutes + " min";

  return {
    words: words,
    chars: chars,
    charsNoSpaces: charsNoSpaces,
    lines: lines,
    sentences: sentences,
    paragraphs: paragraphs,
    readingTime: readingTime
  };
}

function formatNumber(n) {
  return n.toLocaleString();
}

function updateStatusBar() {
  if (!api) return;
  var content = api.editor.getContent();
  var stats = countStats(content || "");
  api.ui.removeStatusBarItem("stats");
  api.ui.addStatusBarItem({
    id: "stats",
    text: formatNumber(stats.words) + " words \u00B7 " + stats.readingTime + " read",
    title: formatNumber(stats.chars) + " characters \u00B7 " + formatNumber(stats.lines) + " lines",
    onClick: function() { showDetailedStats(); }
  });
}

function showDetailedStats() {
  if (!api) return;
  var content = api.editor.getContent();
  var stats = countStats(content || "");

  // Get selection stats too
  var selection = api.editor.getSelection();
  var hasSelection = selection && selection.length > 0;

  var msg = "Document: " +
    formatNumber(stats.words) + " words, " +
    formatNumber(stats.chars) + " chars, " +
    formatNumber(stats.lines) + " lines, " +
    formatNumber(stats.sentences) + " sentences, " +
    formatNumber(stats.paragraphs) + " paragraphs, " +
    stats.readingTime + " read";

  if (hasSelection) {
    var selStats = countStats(selection);
    msg += " | Selection: " +
      formatNumber(selStats.words) + " words, " +
      formatNumber(selStats.chars) + " chars";
  }

  api.ui.showNotice(msg, 5000);
}

module.exports = {
  onLoad: function(pluginApi) {
    api = pluginApi;

    // Initial update
    updateStatusBar();

    // Update on editor changes (debounced)
    api.events.on("editor-change", function() {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(updateStatusBar, 300);
    });

    // Update when a different file is opened
    api.events.on("file-open", function() {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(updateStatusBar, 100);
    });

    // Add command for detailed stats
    api.ui.addCommand({
      id: "show-stats",
      name: "Word Count: Show detailed stats",
      callback: showDetailedStats
    });
  },

  onUnload: function() {
    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
    api = null;
  }
};
