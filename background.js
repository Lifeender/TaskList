// Background Service Worker for TaskList Extension

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "chrome://newtab" });
});

// Handle OAuth token requests from the New Tab page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_AUTH_TOKEN") {
    getAuthToken(message.interactive, message.customClientId)
      .then((token) => sendResponse({ success: true, token }))
      .catch((error) =>
        sendResponse({ success: false, error: error.message || String(error) })
      );
    return true; // Keep message channel open for async response
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
});

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
