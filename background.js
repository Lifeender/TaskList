// Background Service Worker for TaskList Extension

const DEFAULT_GITHUB_REPO = "Lifeender/TaskList";
const UPDATE_ALARM_NAME = "github_update_check";

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "chrome://newtab" });
});

// Setup periodic GitHub update checks (every 30 minutes)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM_NAME, { periodInMinutes: 30 });
  checkForGitHubUpdates(false);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(UPDATE_ALARM_NAME, { periodInMinutes: 30 });
  checkForGitHubUpdates(false);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) {
    checkForGitHubUpdates(false);
  }
});

// Handle OAuth token & GitHub Auto-Update requests from the New Tab page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_AUTH_TOKEN") {
    getAuthToken(message.interactive, message.customClientId)
      .then((token) => sendResponse({ success: true, token }))
      .catch((error) =>
        sendResponse({ success: false, error: error.message || String(error) })
      );
    return true;
  }

  if (message.type === "REMOVE_CACHED_TOKEN") {
    chrome.storage.local.remove(["webAuthToken", "webAuthTokenExpiresAt"], () => {
      if (message.token) {
        chrome.identity.removeCachedAuthToken({ token: message.token }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  if (message.type === "CHECK_GITHUB_UPDATE") {
    checkForGitHubUpdates(true, message.githubRepo, message.githubBranch)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message || String(error)
        })
      );
    return true;
  }

  if (message.type === "TRIGGER_LOCAL_GIT_PULL") {
    // Attempt to call optional local auto-updater daemon if running on localhost:49152
    fetch("http://127.0.0.1:49152/pull", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.updated) {
          sendResponse({ success: true, reloaded: true, output: data.output });
          setTimeout(() => chrome.runtime.reload(), 600);
        } else {
          sendResponse({
            success: true,
            reloaded: false,
            output: (data && data.output) || "Already up to date."
          });
        }
      })
      .catch(() => {
        sendResponse({
          success: false,
          error:
            "Local background watcher isn't running yet. Run auto-update-PC.ps1 (Windows) or auto-update-Mac.sh (macOS) to enable automatic background git pull!"
        });
      });
    return true;
  }
});

async function checkForGitHubUpdates(
  force = false,
  repoOverride = "",
  branchOverride = ""
) {
  const syncCfg = await chrome.storage.sync.get(["githubRepo", "githubBranch"]);
  const repo = (repoOverride || syncCfg.githubRepo || DEFAULT_GITHUB_REPO).trim();
  const branch = (branchOverride || syncCfg.githubBranch || "main").trim();
  const localVersion = chrome.runtime.getManifest().version;

  // Fetch remote manifest.json from GitHub raw content with cache-busting query param
  const rawManifestUrl = `https://raw.githubusercontent.com/${repo}/${branch}/manifest.json?t=${Date.now()}`;
  const commitsApiUrl = `https://api.github.com/repos/${repo}/commits/${branch}`;

  const manifestRes = await fetch(rawManifestUrl, { cache: "no-store" });
  if (!manifestRes.ok) {
    throw new Error(
      `Could not reach GitHub repo "${repo}" (${branch}). Make sure the repository is pushed and public.`
    );
  }

  const remoteManifest = await manifestRes.json();
  const remoteVersion = remoteManifest.version || localVersion;

  let latestCommitSha = "";
  let latestCommitMsg = "";
  let latestCommitDate = "";

  try {
    const commitRes = await fetch(commitsApiUrl, {
      headers: { Accept: "application/vnd.github.v3+json" },
      cache: "no-store"
    });
    if (commitRes.ok) {
      const commitData = await commitRes.json();
      latestCommitSha = (commitData.sha || "").substring(0, 7);
      latestCommitMsg =
        (commitData.commit && commitData.commit.message) || "";
      latestCommitDate =
        (commitData.commit &&
          commitData.commit.committer &&
          commitData.commit.committer.date) ||
        "";
    }
  } catch (_) {
    // Non-fatal if GitHub API rate-limits
  }

  const localStore = await chrome.storage.local.get(["lastKnownCommitSha"]);
  const lastKnownSha = localStore.lastKnownCommitSha || "";

  // First time seeing a commit SHA: baseline it if versions match
  if (!lastKnownSha && latestCommitSha && remoteVersion === localVersion) {
    await chrome.storage.local.set({ lastKnownCommitSha: latestCommitSha });
  }

  const versionNewer = compareSemver(remoteVersion, localVersion) > 0;
  const commitChanged =
    latestCommitSha && lastKnownSha && latestCommitSha !== lastKnownSha;
  const updateAvailable = versionNewer || Boolean(commitChanged);

  const statusObj = {
    success: true,
    repo,
    branch,
    localVersion,
    remoteVersion,
    latestCommitSha,
    latestCommitMsg: latestCommitMsg.split("\n")[0],
    latestCommitDate,
    updateAvailable,
    checkedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ githubUpdateStatus: statusObj });
  return statusObj;
}

function compareSemver(a, b) {
  const pa = String(a)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}


async function getAuthToken(interactive = false, customClientId = "") {
  const manifest = chrome.runtime.getManifest();
  const manifestClientId = manifest.oauth2 && manifest.oauth2.client_id;
  const hasManifestClientId =
    manifestClientId &&
    !manifestClientId.startsWith("YOUR_GOOGLE_OAUTH_CLIENT_ID");

  // 1. Check if we have a cached WebAuthFlow token first when using customClientId
  if (customClientId) {
    const cached = await chrome.storage.local.get([
      "webAuthToken",
      "webAuthTokenExpiresAt"
    ]);
    if (
      cached.webAuthToken &&
      cached.webAuthTokenExpiresAt &&
      Date.now() < cached.webAuthTokenExpiresAt
    ) {
      return cached.webAuthToken;
    }
  }

  // 2. Use native chrome.identity.getAuthToken if manifest.json has a configured client_id and no override
  if (hasManifestClientId && (!customClientId || customClientId === manifestClientId)) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!token) {
          reject(new Error("No token returned."));
        } else {
          resolve(token);
        }
      });
    });
  }

  // 3. Otherwise use launchWebAuthFlow with the Client ID entered in the extension Settings UI
  const clientIdToUse = customClientId || (hasManifestClientId ? manifestClientId : "");
  if (!clientIdToUse) {
    throw new Error(
      "OAuth Client ID is not configured yet. Open Settings to connect Google Tasks."
    );
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const scope = encodeURIComponent("https://www.googleapis.com/auth/tasks");
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientIdToUse)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    `&prompt=${interactive ? "select_account" : "none"}`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!responseUrl) {
          reject(new Error("Authorization flow cancelled."));
          return;
        }
        const hashParams = new URLSearchParams(
          new URL(responseUrl).hash.substring(1)
        );
        const accessToken = hashParams.get("access_token");
        const expiresIn = parseInt(hashParams.get("expires_in") || "3599", 10);
        if (accessToken) {
          const expiresAt = Date.now() + (expiresIn - 60) * 1000;
          chrome.storage.local.set({
            webAuthToken: accessToken,
            webAuthTokenExpiresAt: expiresAt
          });
          resolve(accessToken);
        } else {
          reject(new Error("No access_token found in redirect URL."));
        }
      }
    );
  });
}
