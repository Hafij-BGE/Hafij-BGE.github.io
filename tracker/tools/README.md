# Updates from Claude

The owner creates a code in **Settings → Let Claude add data for you** and gives it to Claude.
Claude encrypts an update with that code and commits it to `tracker/updates/`:

```bash
node tracker/tools/claude-update.mjs "<owner code>" items.json .
git add tracker/updates && git commit -m "Research Log update" && git push
```

`items.json` is `{"items": [...]}` in the same format as the app's "Add data with Claude" instructions.
The app unlocks updates with the code stored in the owner's account (AES-256-GCM, PBKDF2-SHA256 key),
merges them (add / fill / `_update`), never deletes, and offers **Undo last update**.
Without the code the files are unreadable; **Replace code** revokes access immediately.
