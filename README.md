<p align="center">
  <h1 align="center">Noteriv Plugins</h1>
  <p align="center">
    Community plugins for <a href="https://noteriv.com">Noteriv</a> — a modern markdown editor.
    <br />
    <a href="#installing">Install</a> · <a href="#creating-a-plugin">Create your own</a> · <a href="#contributing">Contribute</a>
  </p>
</p>

<br />

## Plugins

| Plugin | Author | Description |
|---|---|---|
| **Word Count** | Jace Sleeman | Live word, character, and reading time stats in the status bar. Click for detailed breakdown. |

<br />

---

<br />

## Installing

### Manually

1. Download a plugin folder from [`plugins/`](./plugins)
2. Copy it into your vault at `.noteriv/plugins/`
3. Open **Settings > Ecosystem > Plugins** and toggle it on

Your vault should look like:
```
your-vault/
  .noteriv/
    plugins/
      word-count/
        manifest.json
        main.js
```

<br />

## Creating a Plugin

A plugin is a folder with two files: `manifest.json` and `main.js`.

### manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": "Your Name",
  "main": "main.js"
}
```

### main.js

```javascript
module.exports = {
  onLoad: function(api) {
    // Called when the plugin is enabled
    // Use api.vault, api.ui, api.editor, api.events, api.app
  },

  onUnload: function() {
    // Called when the plugin is disabled
    // Clean up timers, listeners, etc.
  }
};
```

### Plugin API

| API | Methods |
|---|---|
| **vault** | `read(path)`, `write(path, content)`, `list(dir)`, `exists(path)`, `delete(path)` |
| **ui** | `addCommand(cmd)`, `addStatusBarItem(item)`, `addSidebarPanel(panel)`, `addSettingsTab(tab)`, `showNotice(msg, duration)` |
| **editor** | `getContent()`, `setContent(content)`, `insertAtCursor(text)`, `getSelection()`, `replaceSelection(text)`, `getCursorPosition()` |
| **events** | `on(event, handler)`, `off(event, handler)`, `emit(event, ...args)` |
| **app** | `version`, `vaultPath`, `currentFile` |

### Events

| Event | When |
|---|---|
| `file-open` | A file is opened in the editor |
| `file-save` | A file is saved |
| `file-create` | A new file is created |
| `file-delete` | A file is deleted |
| `editor-change` | Editor content changes |
| `vault-change` | Vault structure changes |
| `layout-change` | App layout changes |

### Tips

- Plugins run sandboxed — you can only access files inside the vault
- All UI registrations auto-cleanup when disabled, but clean up timers in `onUnload`
- Use `ui.showNotice()` for user feedback
- Debounce `editor-change` handlers — they fire on every keystroke
- Use plain JavaScript (no import/export, no JSX) — plugins are `Function()` evaluated

<br />

## Contributing

1. **Fork** this repo
2. Add your plugin folder to `plugins/`
3. Update `manifest.json` at the repo root with your plugin entry
4. Open a **PR** — include a description of what the plugin does

### Guidelines

- Use a unique `id` in lowercase kebab-case
- Test your plugin in Noteriv before submitting
- Include a clear `description` in your manifest
- Clean up all resources in `onUnload`
- Don't access files outside the vault

<br />

---

<p align="center">
  Made for <a href="https://noteriv.com">Noteriv</a>
</p>
