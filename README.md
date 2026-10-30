# TaskList — Chrome New Tab Extension (PC, MacBook & Google Gemini Sync)

A clean, dark-mode Chrome New Tab extension that keeps your task lists synced across your **PC** and **MacBook** via your Google account, and connects directly to **Google Tasks** so you can ask **Google Gemini** to add, complete, or edit tasks on your list.

## Features
- **Google Search Bar** at the top of every new tab (press `/` anywhere to focus search, or type a URL/search query).
- **Multiple Task Lists, Due Dates & Task Notes**: Defaults to a list named `TaskList`, with support for creating/switching multiple lists, setting due dates, and expanding task notes.
- **Dual-Mode Cross-Device Sync**:
  1. **Zero-Config Chrome Sync (Instant)**: Works out-of-the-box using `chrome.storage.sync` tied to your signed-in Chrome profile across PC and MacBook, plus local caching (`chrome.storage.local`) for instant offline load.
  2. **Google Tasks + Google Gemini Live Sync**: Connect your Google account so your lists sync two-way with Google Tasks (`https://tasks.googleapis.com`).

---

## How to Install on PC & MacBook (Chrome)

### One-Line Setup for MacBook (Terminal)
Open **Terminal** on your MacBook and paste this single command to clone the repository to your Desktop and activate the automatic background GitHub updater:
```bash
git clone https://github.com/Lifeender/TaskList.git ~/Desktop/TaskList && ~/Desktop/TaskList/setup-Mac.command
```

### One-Line Setup for Windows PC (PowerShell)
Open **PowerShell** on your Windows PC and paste this single command to clone the repository to your Desktop (or update it if already present) and activate the automatic background GitHub updater:
```powershell
git clone https://github.com/Lifeender/TaskList.git "$HOME\Desktop\TaskList"; powershell -ExecutionPolicy Bypass -File "$HOME\Desktop\TaskList\setup-PC.ps1"
```

### Final Step in Chrome (Both PC & Mac)
1. Open Google Chrome and navigate to:
   ```
   chrome://extensions
   ```
2. Toggle **Developer mode** ON (top-right corner).
3. Click **Load unpacked** (top-left corner) and select the `TaskList` folder on your Desktop.
4. Open a **New Tab** (`Ctrl+T` on PC / `Cmd+T` on Mac) and click **Keep it** if Chrome asks whether to keep the new tab page change.
   *(Because `manifest.json` includes a fixed deterministic public key, both your PC and MacBook receive the exact same Extension ID so Chrome Sync and Google OAuth work seamlessly across both devices!)*

---

## Connecting Google Tasks & Google Gemini

To let **Google Gemini** add or edit tasks on your New Tab page:

1. **Enable Google Workspace in Gemini**:
   - Open [gemini.google.com/extensions](https://gemini.google.com/extensions) and make sure the **Google Workspace** extension is toggled **ON**.
2. **Create a Free Google OAuth Client ID**:
   - Open a New Tab and click the **Gear icon (Settings)** or **Ask Gemini** pill in the top-right corner of the extension.
   - Copy the **Redirect URI** displayed inside the Settings modal (e.g. `https://<your-extension-id>.chromiumapp.org/`).
   - Visit the [Google Cloud Console — Tasks API](https://console.cloud.google.com/apis/library/tasks.googleapis.com) and click **Enable**.
   - Go to [Credentials](https://console.cloud.google.com/apis/credentials) &rarr; **Create Credentials** &rarr; **OAuth client ID**.
   - Select **Web application** as the Application Type, and under **Authorized redirect URIs**, paste the Redirect URI from the extension Settings modal (if your Mac has a different Extension ID, you can add both Redirect URIs to the same Web application Client ID!).
3. **Sign In**:
   - Paste your Client ID (`xxxx.apps.googleusercontent.com`) into the extension's Settings modal, click **Save ID**, and click **Sign in with Google**.
   - Because the Client ID is saved in `chrome.storage.sync`, it automatically syncs to your other computer!

### Example Gemini Prompts
Once connected, you can talk to Gemini on the web, your phone, or the Mac/PC app:
- *"Add 'Buy groceries' to my TaskList list in Google Tasks"*
- *"Add 'Finish project report due Friday' to my TaskList list in Google Tasks"*
- *"Mark 'Buy groceries' as completed in Google Tasks"*
- *"What's on my TaskList list in Google Tasks?"*

---

## GitHub Auto-Update Feature (PC & MacBook)

This extension includes a built-in **GitHub Update Checker** plus cross-platform **Background Git Auto-Pull Scripts** so your extension stays updated whenever you push new commits to `Lifeender/TaskList`.

### 1. In-Extension GitHub Checker & Reload
- Every 30 minutes (or when you click **Check for Updates** in Settings), the extension checks your GitHub repo (`Lifeender/TaskList`) for new commits or a bumped `version` in `manifest.json`.
- When a new commit is pushed, a green **⬆ Update Available** pill appears in the top bar of your New Tab page.
- Clicking **Pull & Reload Now** in Settings reloads the extension runtime (`chrome.runtime.reload()`) with the latest files.

### 2. Automatic Background `git pull` on Windows PC (`auto-update-PC.ps1`)
In PowerShell inside the `TaskListFiles` folder:
```powershell
# Pull latest changes right now:
.\auto-update-PC.ps1

# Install a silent Windows Scheduled Task that runs `git pull` every 15 minutes:
.\auto-update-PC.ps1 -InstallScheduledTask

# Optional: Run the instant localhost listener so clicking "Pull & Reload Now" in Chrome runs `git pull` immediately:
.\auto-update-PC.ps1 -Serve
```

### 3. Automatic Background `git pull` on MacBook (`auto-update-Mac.sh`)
In Terminal inside your cloned `TaskList` folder on macOS:
```bash
chmod +x auto-update-Mac.sh

# Pull latest changes right now:
./auto-update-Mac.sh

# Install a silent macOS LaunchAgent that runs `git pull` every 15 minutes in the background:
./auto-update-Mac.sh --install
```

