# MCP Setup for this Project

This project ships a project-scoped MCP configuration in `.cursor/mcp.json`.
Cursor auto-loads it for any chat opened inside this workspace.

## Servers

### `google-sheets` — `xing5/mcp-google-sheets`

A Python MCP server that exposes 25+ tools over the Google Sheets and Drive
APIs (read/write cells, manage sheets, list spreadsheets, batch ops, sharing,
formatting, etc.). Run via `uvx`, OAuth 2.0 auth.

#### One-time setup

1. **Install `uv`** (provides `uvx`). Already done if you ran the original
   setup, otherwise:

   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **Enable APIs** in your Google Cloud project:
   - Google Sheets API
   - Google Drive API

3. **Create an OAuth 2.0 Client ID** of type **Desktop app**:
   - Google Cloud Console → APIs & Services → Credentials
   - "+ CREATE CREDENTIALS" → "OAuth client ID" → Application type: *Desktop app*
   - Download the JSON.

4. **Configure the OAuth consent screen** with these scopes (User type:
   *External*; if app is still in *Testing*, add your Google account under
   *Test users*):
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive`

5. **Drop the credentials file** at:

   ```
   .cursor/secrets/credentials.json
   ```

   (The whole `.cursor/secrets/` folder is gitignored.)

6. **Reload MCP servers in Cursor**: open the MCP panel (Settings → MCP) or
   restart Cursor. The `google-sheets` server should show as ready.

7. **First tool call triggers a browser sign-in**. After consent, a
   `token.json` is written next to `credentials.json` and reused on subsequent
   runs. The refresh token auto-renews — you usually only sign in once.

#### Quick smoke test

In a Cursor chat, ask: "List my Google spreadsheets". The agent should call
`list_spreadsheets` and return a list. (First call may pause while a browser
window opens — approve the OAuth consent.)

#### Troubleshooting

- **`spawn uvx ENOENT`** — `uvx` is not on PATH. The config already pins the
  full path `/Users/amir/.local/bin/uvx` to avoid this.
- **`access_denied` / "App not verified"** — your OAuth consent screen is in
  *Testing* and your account isn't added as a Test user. Add it.
- **Server hangs on first call** — a browser tab is waiting for consent.
  Cursor swallows the launch sometimes; check open browser windows or run
  the server once in a terminal to do the initial auth dance:

  ```bash
  CREDENTIALS_PATH="$PWD/.cursor/secrets/credentials.json" \
  TOKEN_PATH="$PWD/.cursor/secrets/token.json" \
  /Users/amir/.local/bin/uvx mcp-google-sheets@latest
  ```

  Hit Ctrl-C once `token.json` is written.
- **Want service-account auth instead** (no browser, headless) — replace the
  env block in `.cursor/mcp.json` with `SERVICE_ACCOUNT_PATH` pointing at a
  service account JSON, and share each spreadsheet with the service account's
  email.
