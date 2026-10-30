// TaskList — New Tab & Google Tasks / Gemini Sync Logic

const TASKS_API_BASE = "https://tasks.googleapis.com/tasks/v1";

// Application State
const state = {
  mode: "local", // "local" (chrome.storage.sync) or "google" (Google Tasks API)
  authToken: null,
  customClientId: "",
  lists: [], // [{ id, title }]
  activeListId: "default-tasklist",
  tasksByList: {}, // { [listId]: [{ id, title, notes, due, status, parent, position, updated }] }
  collapsedGroups: {}, // { [taskId]: true }
  inlineSubtaskParentId: null,
  filter: "all" // "all" | "active" | "completed"
};

// DOM Elements
const els = {
  searchForm: document.getElementById("google-search-form"),
  searchInput: document.getElementById("search-input"),
  syncBadge: document.getElementById("sync-badge"),
  syncStatusText: document.getElementById("sync-status-text"),
  refreshBtn: document.getElementById("refresh-btn"),
  geminiTipBtn: document.getElementById("gemini-tip-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  listsNav: document.getElementById("task-lists-nav"),
  newListBtn: document.getElementById("new-list-btn"),
  newListForm: document.getElementById("new-list-form"),
  newListInput: document.getElementById("new-list-input"),
  cancelListBtn: document.getElementById("cancel-list-btn"),
  activeListPromptName: document.getElementById("active-list-prompt-name"),
  currentListTitle: document.getElementById("current-list-title"),
  taskCounter: document.getElementById("task-counter"),
  filterTabs: document.querySelectorAll(".filter-tab"),
  clearCompletedBtn: document.getElementById("clear-completed-btn"),
  addTaskForm: document.getElementById("add-task-form"),
  taskTitleInput: document.getElementById("task-title-input"),
  taskParentSelect: document.getElementById("task-parent-select"),
  taskDueInput: document.getElementById("task-due-input"),
  toggleNotesBtn: document.getElementById("toggle-notes-btn"),
  composerNotesWrap: document.getElementById("composer-notes-wrap"),
  taskNotesInput: document.getElementById("task-notes-input"),
  tasksContainer: document.getElementById("tasks-container"),
  emptyState: document.getElementById("empty-state"),
  emptyListName: document.getElementById("empty-list-name"),
  // Edit Modal
  editModal: document.getElementById("edit-modal"),
  closeEditModal: document.getElementById("close-edit-modal"),
  cancelEditBtn: document.getElementById("cancel-edit-btn"),
  editTaskForm: document.getElementById("edit-task-form"),
  editTaskId: document.getElementById("edit-task-id"),
  editTaskTitle: document.getElementById("edit-task-title"),
  editTaskParent: document.getElementById("edit-task-parent"),
  editTaskDue: document.getElementById("edit-task-due"),
  editTaskNotes: document.getElementById("edit-task-notes"),
  deleteTaskModalBtn: document.getElementById("delete-task-modal-btn"),
  // Settings Modal
  settingsModal: document.getElementById("settings-modal"),
  closeSettingsModal: document.getElementById("close-settings-modal"),
  connectGoogleBtn: document.getElementById("connect-google-btn"),
  disconnectGoogleBtn: document.getElementById("disconnect-google-btn"),
  connectionTitle: document.getElementById("connection-title"),
  connectionDesc: document.getElementById("connection-desc"),
  oauthClientIdInput: document.getElementById("oauth-client-id-input"),
  saveClientIdBtn: document.getElementById("save-client-id-btn"),
  extIdDisplay: document.getElementById("ext-id-display"),
  redirectUriDisplay: document.getElementById("redirect-uri-display"),
  updateBannerBtn: document.getElementById("update-banner-btn"),
  githubRepoInput: document.getElementById("github-repo-input"),
  checkUpdateBtn: document.getElementById("check-update-btn"),
  pullReloadBtn: document.getElementById("pull-reload-btn"),
  localVersionDisplay: document.getElementById("local-version-display"),
  remoteVersionDisplay: document.getElementById("remote-version-display"),
  toast: document.getElementById("toast")
};

// Initialize App
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  populateExtensionDiagnostics();
  await loadCachedState();
  renderAll();
  await trySilentGoogleConnect();

  // Auto-sync when switching back to the tab (e.g., right after asking Gemini to add a task)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.mode === "google") {
      syncWithGoogleTasks(false);
    }
  });
});

function populateExtensionDiagnostics() {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
    els.extIdDisplay.textContent = chrome.runtime.id;
    const manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version && els.localVersionDisplay) {
      els.localVersionDisplay.textContent = manifest.version;
    }
  } else {
    els.extIdDisplay.textContent = "Load as Unpacked Extension in chrome://extensions";
  }

  if (typeof chrome !== "undefined" && chrome.identity && chrome.identity.getRedirectURL) {
    els.redirectUriDisplay.textContent = chrome.identity.getRedirectURL();
  } else {
    els.redirectUriDisplay.textContent = "https://<extension-id>.chromiumapp.org/";
  }

  initGitHubUpdateStatus();
}

async function initGitHubUpdateStatus() {
  if (typeof chrome === "undefined" || !chrome.storage) return;

  const syncCfg = await chrome.storage.sync.get(["githubRepo"]);
  if (syncCfg.githubRepo && els.githubRepoInput) {
    els.githubRepoInput.value = syncCfg.githubRepo;
  }

  const localStore = await chrome.storage.local.get(["githubUpdateStatus"]);
  if (localStore.githubUpdateStatus) {
    renderGitHubUpdateStatus(localStore.githubUpdateStatus);
  }
}

function renderGitHubUpdateStatus(status) {
  if (!status || !els.remoteVersionDisplay) return;
  if (!status.success) {
    els.remoteVersionDisplay.textContent = status.error || "Unable to check GitHub";
    return;
  }

  const shaPart = status.latestCommitSha ? ` (commit ${status.latestCommitSha})` : "";
  if (status.updateAvailable) {
    els.remoteVersionDisplay.textContent = `Update available: v${status.remoteVersion}${shaPart}`;
    els.remoteVersionDisplay.style.color = "#4ade80";
    if (els.updateBannerBtn) els.updateBannerBtn.classList.remove("hidden");
  } else {
    els.remoteVersionDisplay.textContent = `Up to date: v${status.remoteVersion}${shaPart}`;
    els.remoteVersionDisplay.style.color = "#93c5fd";
    if (els.updateBannerBtn) els.updateBannerBtn.classList.add("hidden");
  }
}

// ==========================================
// Storage & State Persistence (Chrome Sync + Local Cache)
// ==========================================

async function loadCachedState() {
  if (typeof chrome === "undefined" || !chrome.storage) {
    // Fallback for previewing in normal browser tab
    const raw = localStorage.getItem("tasklist_backup_state");
    if (raw) Object.assign(state, JSON.parse(raw));
    ensureDefaultList();
    return;
  }

  const syncData = await chrome.storage.sync.get([
    "customClientId",
    "activeListId",
    "syncLists",
    "syncTasksByList",
    "googleConnected"
  ]);

  const localData = await chrome.storage.local.get([
    "cachedLists",
    "cachedTasksByList"
  ]);

  if (syncData.customClientId) {
    state.customClientId = syncData.customClientId;
    els.oauthClientIdInput.value = syncData.customClientId;
  }

  if (syncData.activeListId) {
    state.activeListId = syncData.activeListId;
  }

  state.lists = syncData.syncLists || localData.cachedLists || [];
  state.tasksByList = syncData.syncTasksByList || localData.cachedTasksByList || {};

  ensureDefaultList();

  // Listen for Chrome Sync changes from other devices (PC <-> MacBook)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
      let updated = false;
      if (changes.syncLists && state.mode === "local") {
        state.lists = changes.syncLists.newValue || [];
        updated = true;
      }
      if (changes.syncTasksByList && state.mode === "local") {
        state.tasksByList = changes.syncTasksByList.newValue || {};
        updated = true;
      }
      if (changes.customClientId) {
        state.customClientId = changes.customClientId.newValue || "";
        els.oauthClientIdInput.value = state.customClientId;
      }
      if (updated) {
        ensureDefaultList();
        renderAll();
      }
    }
  });
}

function ensureDefaultList() {
  if (!state.lists || state.lists.length === 0) {
    state.lists = [{ id: "default-tasklist", title: "TaskList" }];
  }
  const exists = state.lists.some((l) => l.id === state.activeListId);
  if (!exists) {
    // Prefer a list named "TaskList" if present
    const preferred = state.lists.find(
      (l) => l.title.toLowerCase() === "tasklist"
    );
    state.activeListId = preferred ? preferred.id : state.lists[0].id;
  }
  if (!state.tasksByList[state.activeListId]) {
    state.tasksByList[state.activeListId] = [];
  }
}

async function saveStateToStorage() {
  if (typeof chrome === "undefined" || !chrome.storage) {
    localStorage.setItem("tasklist_backup_state", JSON.stringify(state));
    return;
  }

  // Always save to local storage for instant startup
  await chrome.storage.local.set({
    cachedLists: state.lists,
    cachedTasksByList: state.tasksByList
  });

  // Also save to chrome.storage.sync so PC and Mac stay synced even without Google Cloud OAuth
  try {
    await chrome.storage.sync.set({
      activeListId: state.activeListId,
      syncLists: state.lists,
      syncTasksByList: state.tasksByList
    });
  } catch (e) {
    // If sync quota exceeded for large task sets, local cache still holds everything
    console.warn("chrome.storage.sync quota warning:", e);
  }
}

// ==========================================
// Google Tasks API & OAuth Connection
// ==========================================

async function trySilentGoogleConnect() {
  if (typeof chrome === "undefined" || !chrome.runtime) return;

  const syncData = await chrome.storage.sync.get(["googleConnected", "customClientId"]);
  const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
  const hasManifestId =
    manifest &&
    manifest.oauth2 &&
    manifest.oauth2.client_id &&
    !manifest.oauth2.client_id.startsWith("YOUR_GOOGLE_OAUTH_CLIENT_ID");

  if (!syncData.googleConnected && !hasManifestId) {
    updateSyncIndicator("local");
    return;
  }

  updateSyncIndicator("syncing");
  chrome.runtime.sendMessage(
    {
      type: "GET_AUTH_TOKEN",
      interactive: false,
      customClientId: state.customClientId
    },
    async (response) => {
      if (response && response.success && response.token) {
        state.authToken = response.token;
        state.mode = "google";
        updateConnectionModalUI(true);
        await syncWithGoogleTasks(false);
      } else {
        updateSyncIndicator("local");
        updateConnectionModalUI(false);
      }
    }
  );
}

async function connectGoogleInteractive() {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    showToast("Load this folder as an Unpacked Extension in Chrome first.");
    return;
  }

  const clientIdVal = els.oauthClientIdInput.value.trim();
  if (clientIdVal) {
    state.customClientId = clientIdVal;
    await chrome.storage.sync.set({ customClientId: clientIdVal });
  }

  updateSyncIndicator("syncing");
  chrome.runtime.sendMessage(
    {
      type: "GET_AUTH_TOKEN",
      interactive: true,
      customClientId: state.customClientId
    },
    async (response) => {
      if (response && response.success && response.token) {
        state.authToken = response.token;
        state.mode = "google";
        await chrome.storage.sync.set({ googleConnected: true });
        updateConnectionModalUI(true);
        showToast("Connected to Google Tasks!");
        await syncWithGoogleTasks(true);
      } else {
        updateSyncIndicator("local");
        updateConnectionModalUI(false);
        showToast(
          (response && response.error) ||
            "Could not sign in. Check your OAuth Client ID in Settings."
        );
      }
    }
  );
}

async function disconnectGoogle() {
  if (typeof chrome !== "undefined" && chrome.runtime) {
    chrome.runtime.sendMessage({
      type: "REMOVE_CACHED_TOKEN",
      token: state.authToken
    });
    await chrome.storage.sync.set({ googleConnected: false });
  }
  state.authToken = null;
  state.mode = "local";
  updateConnectionModalUI(false);
  updateSyncIndicator("local");
  showToast("Switched to Chrome Sync mode.");
}

async function googleApiFetch(endpoint, options = {}) {
  if (!state.authToken) throw new Error("Not authenticated with Google Tasks");

  const res = await fetch(`${TASKS_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.authToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (res.status === 401) {
    // Token expired; clear and retry once
    await new Promise((resolve) =>
      chrome.runtime.sendMessage(
        { type: "REMOVE_CACHED_TOKEN", token: state.authToken },
        resolve
      )
    );
    state.authToken = null;
    throw new Error("Session expired. Click Refresh to reconnect.");
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Tasks API error (${res.status}): ${errText}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function syncWithGoogleTasks(ensureTaskListExists = false) {
  if (state.mode !== "google" || !state.authToken) return;

  updateSyncIndicator("syncing");
  els.refreshBtn.classList.add("spinning");

  try {
    const listsRes = await googleApiFetch("/users/@me/lists?maxResults=100");
    let remoteLists = (listsRes.items || []).map((item) => ({
      id: item.id,
      title: item.title
    }));

    // Ensure a "TaskList" list exists if user just connected for the first time
    const hasTaskList = remoteLists.some(
      (l) => l.title.toLowerCase() === "tasklist"
    );

    if (ensureTaskListExists && !hasTaskList) {
      const createdList = await googleApiFetch("/users/@me/lists", {
        method: "POST",
        body: JSON.stringify({ title: "TaskList" })
      });
      remoteLists.unshift({ id: createdList.id, title: createdList.title });

      // Migrate any local default tasks created before signing in
      const localDefaultTasks = state.tasksByList["default-tasklist"] || [];
      for (const localTask of localDefaultTasks) {
        await googleApiFetch(`/lists/${createdList.id}/tasks`, {
          method: "POST",
          body: JSON.stringify({
            title: localTask.title,
            notes: localTask.notes || "",
            due: localTask.due ? new Date(localTask.due).toISOString() : undefined,
            status: localTask.status || "needsAction"
          })
        });
      }
      delete state.tasksByList["default-tasklist"];
      state.activeListId = createdList.id;
    }

    state.lists = remoteLists;
    ensureDefaultList();

    // Fetch tasks for active list
    await fetchTasksForList(state.activeListId);

    await saveStateToStorage();
    renderAll();
    updateSyncIndicator("google");
  } catch (err) {
    console.error("Google Tasks Sync Error:", err);
    showToast(err.message || "Sync failed");
    updateSyncIndicator("local");
  } finally {
    els.refreshBtn.classList.remove("spinning");
  }
}

async function fetchTasksForList(listId) {
  if (state.mode !== "google" || !state.authToken) return;

  const tasksRes = await googleApiFetch(
    `/lists/${encodeURIComponent(listId)}/tasks?showCompleted=true&showHidden=true&maxResults=100`
  );

  const items = (tasksRes.items || [])
    .filter((t) => t.title && t.title.trim() !== "")
    .map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes || "",
      due: t.due ? t.due.substring(0, 10) : "",
      status: t.status || "needsAction",
      parent: t.parent || "",
      position: t.position || "",
      updated: t.updated || new Date().toISOString()
    }));

  state.tasksByList[listId] = items;
}

// ==========================================
// CRUD Operations (Seamless Dual-Mode: Google Tasks + Chrome Sync)
// ==========================================

async function createTaskList(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;

  if (state.mode === "google" && state.authToken) {
    try {
      updateSyncIndicator("syncing");
      const created = await googleApiFetch("/users/@me/lists", {
        method: "POST",
        body: JSON.stringify({ title: cleanTitle })
      });
      state.lists.push({ id: created.id, title: created.title });
      state.activeListId = created.id;
      state.tasksByList[created.id] = [];
      updateSyncIndicator("google");
    } catch (e) {
      showToast("Could not create list in Google Tasks: " + e.message);
      updateSyncIndicator("google");
      return;
    }
  } else {
    const newId = "list-" + Date.now();
    state.lists.push({ id: newId, title: cleanTitle });
    state.activeListId = newId;
    state.tasksByList[newId] = [];
  }

  await saveStateToStorage();
  renderAll();
  showToast(`Created list "${cleanTitle}"`);
}

async function deleteTaskList(listId) {
  if (state.lists.length <= 1) {
    showToast("You must keep at least one task list.");
    return;
  }

  const listObj = state.lists.find((l) => l.id === listId);
  if (!confirm(`Delete list "${listObj ? listObj.title : ""}" and all its tasks?`)) {
    return;
  }

  if (state.mode === "google" && state.authToken) {
    try {
      updateSyncIndicator("syncing");
      await googleApiFetch(`/users/@me/lists/${encodeURIComponent(listId)}`, {
        method: "DELETE"
      });
      updateSyncIndicator("google");
    } catch (e) {
      showToast("Google Tasks prevents deleting your primary default list.");
      updateSyncIndicator("google");
      return;
    }
  }

  state.lists = state.lists.filter((l) => l.id !== listId);
  delete state.tasksByList[listId];
  ensureDefaultList();
  await saveStateToStorage();
  renderAll();
}

async function addTask(title, due, notes, parentId = "") {
  const listId = state.activeListId;
  const cleanTitle = title.trim();
  if (!cleanTitle) return;

  const tempId = "task-" + Date.now();
  const newTask = {
    id: tempId,
    title: cleanTitle,
    notes: (notes || "").trim(),
    due: due || "",
    status: "needsAction",
    parent: parentId || "",
    updated: new Date().toISOString()
  };

  if (!state.tasksByList[listId]) {
    state.tasksByList[listId] = [];
  }
  state.tasksByList[listId].unshift(newTask);
  if (parentId) {
    delete state.collapsedGroups[parentId];
  }
  renderTasks();

  if (state.mode === "google" && state.authToken) {
    try {
      updateSyncIndicator("syncing");
      const payload = {
        title: newTask.title,
        notes: newTask.notes || undefined,
        due: newTask.due ? `${newTask.due}T00:00:00.000Z` : undefined
      };
      const parentQuery = parentId
        ? `?parent=${encodeURIComponent(parentId)}`
        : "";
      const created = await googleApiFetch(
        `/lists/${encodeURIComponent(listId)}/tasks${parentQuery}`,
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );
      newTask.id = created.id;
      newTask.parent = created.parent || parentId || "";
      updateSyncIndicator("google");
    } catch (e) {
      showToast("Saved locally; Google Tasks sync error: " + e.message);
      updateSyncIndicator("local");
    }
  }

  await saveStateToStorage();
  renderTasks();
}

async function toggleTaskStatus(taskId) {
  const listId = state.activeListId;
  const tasks = state.tasksByList[listId] || [];
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  task.status = task.status === "completed" ? "needsAction" : "completed";
  task.updated = new Date().toISOString();
  renderTasks();

  if (state.mode === "google" && state.authToken) {
    try {
      updateSyncIndicator("syncing");
      await googleApiFetch(
        `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: task.status,
            completed: task.status === "completed" ? new Date().toISOString() : null
          })
        }
      );
      updateSyncIndicator("google");
    } catch (e) {
      showToast("Sync error: " + e.message);
    }
  }

  await saveStateToStorage();
}

async function updateTaskDetails(taskId, updates) {
  const listId = state.activeListId;
  const tasks = state.tasksByList[listId] || [];
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const oldParent = task.parent || "";
  const newParent = updates.parent !== undefined ? updates.parent : oldParent;

  task.title = updates.title.trim();
  task.due = updates.due || "";
  task.notes = (updates.notes || "").trim();
  task.parent = newParent;
  task.updated = new Date().toISOString();
  renderTasks();

  if (state.mode === "google" && state.authToken) {
    try {
      updateSyncIndicator("syncing");
      await googleApiFetch(
        `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: task.title,
            notes: task.notes,
            due: task.due ? `${task.due}T00:00:00.000Z` : null
          })
        }
      );

      // If parent group changed, call Google Tasks move endpoint
      if (oldParent !== newParent) {
        const moveQuery = newParent
          ? `?parent=${encodeURIComponent(newParent)}`
          : "";
        await googleApiFetch(
          `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/move${moveQuery}`,
          { method: "POST" }
        );
      }

      updateSyncIndicator("google");
    } catch (e) {
      showToast("Sync error: " + e.message);
    }
  }

  await saveStateToStorage();
}

async function deleteTask(taskId) {
  const listId = state.activeListId;
  const tasks = state.tasksByList[listId] || [];
  // Also delete any subtasks belonging to this group
  const childIds = tasks.filter((t) => t.parent === taskId).map((t) => t.id);
  const idsToRemove = new Set([taskId, ...childIds]);
  state.tasksByList[listId] = tasks.filter((t) => !idsToRemove.has(t.id));
  renderTasks();

  if (state.mode === "google" && state.authToken) {
    try {
      updateSyncIndicator("syncing");
      await googleApiFetch(
        `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: "DELETE" }
      );
      updateSyncIndicator("google");
    } catch (e) {
      showToast("Sync error: " + e.message);
    }
  }

  await saveStateToStorage();
}

async function clearCompletedTasks() {
  const listId = state.activeListId;
  const tasks = state.tasksByList[listId] || [];
  const completed = tasks.filter((t) => t.status === "completed");
  if (completed.length === 0) return;

  state.tasksByList[listId] = tasks.filter((t) => t.status !== "completed");
  renderTasks();

  if (state.mode === "google" && state.authToken) {
    try {
      updateSyncIndicator("syncing");
      await Promise.all(
        completed.map((t) =>
          googleApiFetch(
            `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(t.id)}`,
            { method: "DELETE" }
          )
        )
      );
      updateSyncIndicator("google");
    } catch (e) {
      showToast("Error clearing completed tasks on Google Tasks");
    }
  }

  await saveStateToStorage();
}

// ==========================================
// Rendering UI
// ==========================================

function renderAll() {
  renderListsSidebar();
  renderTasks();
}

function renderListsSidebar() {
  els.listsNav.innerHTML = "";
  const activeList =
    state.lists.find((l) => l.id === state.activeListId) || state.lists[0];

  if (activeList) {
    els.currentListTitle.textContent = activeList.title;
    els.activeListPromptName.textContent = activeList.title;
    els.emptyListName.textContent = activeList.title;
  }

  state.lists.forEach((list) => {
    const li = document.createElement("li");
    li.className = `list-nav-item ${
      list.id === state.activeListId ? "active" : ""
    }`;

    const titleSpan = document.createElement("span");
    titleSpan.className = "list-nav-title";
    titleSpan.textContent = list.title;

    li.appendChild(titleSpan);

    if (state.lists.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "list-delete-btn";
      delBtn.title = "Delete list";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteTaskList(list.id);
      });
      li.appendChild(delBtn);
    }

    li.addEventListener("click", async () => {
      state.activeListId = list.id;
      renderAll();
      if (state.mode === "google" && state.authToken) {
        updateSyncIndicator("syncing");
        await fetchTasksForList(list.id);
        updateSyncIndicator("google");
      }
      await saveStateToStorage();
      renderAll();
    });

    els.listsNav.appendChild(li);
  });
}

function renderTasks() {
  const allTasks = state.tasksByList[state.activeListId] || [];
  const activeCount = allTasks.filter((t) => t.status !== "completed").length;
  els.taskCounter.textContent = `${activeCount} remaining`;

  // Populate parent group dropdowns with top-level tasks
  const topLevelTasks = allTasks.filter((t) => !t.parent);
  populateParentSelect(els.taskParentSelect, topLevelTasks, els.taskParentSelect ? els.taskParentSelect.value : "");

  // Sort helper: incomplete first, then due date
  const sortTasks = (arr) =>
    [...arr].sort((a, b) => {
      if (a.status !== b.status) return a.status === "completed" ? 1 : -1;
      if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      return 0;
    });

  const matchesFilter = (t) => {
    if (state.filter === "active") return t.status !== "completed";
    if (state.filter === "completed") return t.status === "completed";
    return true;
  };

  // Group subtasks by parent ID
  const subtasksByParent = {};
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const roots = [];

  allTasks.forEach((t) => {
    if (t.parent && taskMap.has(t.parent)) {
      if (!subtasksByParent[t.parent]) subtasksByParent[t.parent] = [];
      subtasksByParent[t.parent].push(t);
    } else {
      roots.push(t);
    }
  });

  const sortedRoots = sortTasks(roots);
  els.tasksContainer.innerHTML = "";
  let renderedCount = 0;

  sortedRoots.forEach((rootTask) => {
    const allChildren = sortTasks(subtasksByParent[rootTask.id] || []);
    const visibleChildren = allChildren.filter(matchesFilter);
    const rootMatches = matchesFilter(rootTask);

    // Show root if it matches filter OR if any of its subtasks match the filter
    if (!rootMatches && visibleChildren.length === 0) {
      return;
    }

    renderedCount++;
    const hasSubtasks = allChildren.length > 0;
    const isCollapsed = Boolean(state.collapsedGroups[rootTask.id]);

    const groupWrapper = document.createElement("div");
    groupWrapper.className = "task-group-wrapper";

    const rootEl = createTaskRowElement(rootTask, {
      isSubtask: false,
      hasSubtasks,
      allChildren,
      isCollapsed
    });
    groupWrapper.appendChild(rootEl);

    // Inline "+ Subtask" quick form when active for this group
    if (state.inlineSubtaskParentId === rootTask.id) {
      const subForm = document.createElement("form");
      subForm.className = "inline-subtask-form";

      const subInput = document.createElement("input");
      subInput.type = "text";
      subInput.placeholder = `Add subtask inside "${rootTask.title}"... (Enter)`;
      subInput.required = true;

      const subDue = document.createElement("input");
      subDue.type = "date";
      subDue.title = "Optional subtask due date";

      const saveSubBtn = document.createElement("button");
      saveSubBtn.type = "submit";
      saveSubBtn.className = "btn-primary-xs";
      saveSubBtn.textContent = "Add";

      const cancelSubBtn = document.createElement("button");
      cancelSubBtn.type = "button";
      cancelSubBtn.className = "btn-ghost-xs";
      cancelSubBtn.textContent = "Cancel";
      cancelSubBtn.addEventListener("click", () => {
        state.inlineSubtaskParentId = null;
        renderTasks();
      });

      subForm.appendChild(subInput);
      subForm.appendChild(subDue);
      subForm.appendChild(saveSubBtn);
      subForm.appendChild(cancelSubBtn);

      subForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const subTitle = subInput.value;
        const subDueDate = subDue.value;
        state.inlineSubtaskParentId = null;
        await addTask(subTitle, subDueDate, "", rootTask.id);
      });

      groupWrapper.appendChild(subForm);
      setTimeout(() => subInput.focus(), 0);
    }

    // Render subtasks container if expanded
    if (visibleChildren.length > 0 && !isCollapsed) {
      const subContainer = document.createElement("div");
      subContainer.className = "subtasks-container";

      visibleChildren.forEach((childTask) => {
        const childEl = createTaskRowElement(childTask, {
          isSubtask: true,
          hasSubtasks: false,
          allChildren: [],
          isCollapsed: false
        });
        subContainer.appendChild(childEl);
      });

      groupWrapper.appendChild(subContainer);
    }

    els.tasksContainer.appendChild(groupWrapper);
  });

  if (renderedCount === 0) {
    els.emptyState.classList.remove("hidden");
  } else {
    els.emptyState.classList.add("hidden");
  }
}

function createTaskRowElement(
  task,
  { isSubtask, hasSubtasks, allChildren, isCollapsed }
) {
  const item = document.createElement("div");
  item.className = [
    "task-item",
    task.status === "completed" ? "completed" : "",
    isSubtask ? "is-subtask" : "",
    hasSubtasks ? "is-group-parent" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const left = document.createElement("div");
  left.className = "task-left";

  // Collapse/expand chevron for task groups
  if (!isSubtask && hasSubtasks) {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = `group-toggle-btn ${isCollapsed ? "collapsed" : ""}`;
    toggleBtn.title = isCollapsed ? "Expand subtasks" : "Collapse subtasks";
    toggleBtn.textContent = "▼";
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.collapsedGroups[task.id]) {
        delete state.collapsedGroups[task.id];
      } else {
        state.collapsedGroups[task.id] = true;
      }
      renderTasks();
    });
    left.appendChild(toggleBtn);
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-checkbox";
  checkbox.checked = task.status === "completed";
  checkbox.addEventListener("change", () => toggleTaskStatus(task.id));

  const content = document.createElement("div");
  content.className = "task-content";
  content.addEventListener("click", () => openEditModal(task));

  const titleEl = document.createElement("div");
  titleEl.className = "task-title";
  titleEl.textContent = task.title;
  content.appendChild(titleEl);

  if (task.notes) {
    const notesEl = document.createElement("div");
    notesEl.className = "task-notes";
    notesEl.textContent = task.notes;
    content.appendChild(notesEl);
  }

  if (task.due || hasSubtasks) {
    const meta = document.createElement("div");
    meta.className = "task-meta";

    if (hasSubtasks) {
      const doneSubCount = allChildren.filter(
        (c) => c.status === "completed"
      ).length;
      const groupPill = document.createElement("span");
      groupPill.className = "subtask-count-pill";
      groupPill.textContent = `${doneSubCount}/${allChildren.length} subtasks`;
      meta.appendChild(groupPill);
    }

    if (task.due) {
      const duePill = document.createElement("span");
      const isOverdue =
        task.status !== "completed" &&
        task.due < new Date().toISOString().substring(0, 10);
      duePill.className = `due-pill ${isOverdue ? "overdue" : ""}`;
      duePill.textContent = `Due ${formatDateNice(task.due)}`;
      meta.appendChild(duePill);
    }

    content.appendChild(meta);
  }

  left.appendChild(checkbox);
  left.appendChild(content);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  // Allow any top-level task to act as a Task Group with a "+ Subtask" button
  if (!isSubtask) {
    const addSubBtn = document.createElement("button");
    addSubBtn.type = "button";
    addSubBtn.className = "icon-btn-sm btn-add-subtask-icon";
    addSubBtn.title = "Add subtask to this group";
    addSubBtn.textContent = "+ Subtask";
    addSubBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.inlineSubtaskParentId =
        state.inlineSubtaskParentId === task.id ? null : task.id;
      delete state.collapsedGroups[task.id];
      renderTasks();
    });
    actions.appendChild(addSubBtn);
  }

  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn-sm";
  editBtn.title = "Edit task";
  editBtn.innerHTML = "✎";
  editBtn.addEventListener("click", () => openEditModal(task));

  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn-sm";
  delBtn.title = "Delete task";
  delBtn.innerHTML = "&times;";
  delBtn.addEventListener("click", () => deleteTask(task.id));

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  item.appendChild(left);
  item.appendChild(actions);
  return item;
}

function populateParentSelect(selectEl, topLevelTasks, selectedId = "", excludeTaskId = "") {
  if (!selectEl) return;
  const defaultLabel =
    selectEl === els.editTaskParent
      ? "None (Top-Level Task / Group)"
      : "Top-Level Task / Group";

  selectEl.innerHTML = "";
  const rootOpt = document.createElement("option");
  rootOpt.value = "";
  rootOpt.textContent = defaultLabel;
  selectEl.appendChild(rootOpt);

  topLevelTasks.forEach((t) => {
    if (t.id === excludeTaskId) return;
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `Group: ${t.title}`;
    if (t.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function formatDateNice(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function updateSyncIndicator(status) {
  els.syncBadge.className = "sync-badge";
  if (status === "google") {
    els.syncBadge.classList.add("status-google");
    els.syncStatusText.textContent = "Google Tasks & Gemini Synced";
  } else if (status === "syncing") {
    els.syncBadge.classList.add("status-syncing");
    els.syncStatusText.textContent = "Syncing...";
  } else {
    els.syncBadge.classList.add("status-local");
    els.syncStatusText.textContent = "Chrome Sync (Click to link Gemini)";
  }
}

function updateConnectionModalUI(connected) {
  if (connected) {
    els.connectionTitle.textContent = "Connected to Google Tasks & Gemini";
    els.connectionDesc.textContent =
      "Your tasks are live-synced with Google Tasks across your PC, MacBook, and Google Gemini.";
    els.connectGoogleBtn.classList.add("hidden");
    els.disconnectGoogleBtn.classList.remove("hidden");
  } else {
    els.connectionTitle.textContent = "Currently using Chrome Account Sync";
    els.connectionDesc.textContent =
      "Your tasks automatically sync across your PC and MacBook via Chrome Sync. Connect Google Tasks below so Google Gemini can directly add/edit tasks on your list!";
    els.connectGoogleBtn.classList.remove("hidden");
    els.disconnectGoogleBtn.classList.add("hidden");
  }
}

function openEditModal(task) {
  const allTasks = state.tasksByList[state.activeListId] || [];
  const topLevelTasks = allTasks.filter((t) => !t.parent);
  populateParentSelect(
    els.editTaskParent,
    topLevelTasks,
    task.parent || "",
    task.id
  );

  els.editTaskId.value = task.id;
  els.editTaskTitle.value = task.title;
  els.editTaskDue.value = task.due || "";
  els.editTaskNotes.value = task.notes || "";
  els.editModal.classList.remove("hidden");
  els.editTaskTitle.focus();
}

function closeEditModal() {
  els.editModal.classList.add("hidden");
}

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 3500);
}

// ==========================================
// Event Listeners
// ==========================================

function setupEventListeners() {
  // Search shortcut "/"
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "/" &&
      document.activeElement.tagName !== "INPUT" &&
      document.activeElement.tagName !== "TEXTAREA"
    ) {
      e.preventDefault();
      els.searchInput.focus();
    }
    if (e.key === "Escape") {
      closeEditModal();
      els.settingsModal.classList.add("hidden");
    }
  });

  // Search form smart URL vs Google Search handling
  els.searchForm.addEventListener("submit", (e) => {
    const val = els.searchInput.value.trim();
    if (!val) {
      e.preventDefault();
      return;
    }
    const isUrl =
      /^(https?:\/\/)/i.test(val) ||
      (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(val) && !val.includes(" "));
    if (isUrl) {
      e.preventDefault();
      window.location.href = /^https?:\/\//i.test(val) ? val : `https://${val}`;
    }
  });

  // Add Task
  els.addTaskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = els.taskTitleInput.value;
    const due = els.taskDueInput.value;
    const notes = els.taskNotesInput.value;
    const parentId = els.taskParentSelect ? els.taskParentSelect.value : "";
    els.taskTitleInput.value = "";
    els.taskDueInput.value = "";
    els.taskNotesInput.value = "";
    els.composerNotesWrap.classList.add("hidden");
    await addTask(title, due, notes, parentId);
  });

  els.toggleNotesBtn.addEventListener("click", () => {
    els.composerNotesWrap.classList.toggle("hidden");
    if (!els.composerNotesWrap.classList.contains("hidden")) {
      els.taskNotesInput.focus();
    }
  });

  // Filter Tabs
  els.filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.filterTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.filter = tab.dataset.filter;
      renderTasks();
    });
  });

  els.clearCompletedBtn.addEventListener("click", clearCompletedTasks);

  // Sidebar New List
  els.newListBtn.addEventListener("click", () => {
    els.newListForm.classList.remove("hidden");
    els.newListInput.focus();
  });

  els.cancelListBtn.addEventListener("click", () => {
    els.newListForm.classList.add("hidden");
    els.newListInput.value = "";
  });

  els.newListForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.newListInput.value;
    els.newListInput.value = "";
    els.newListForm.classList.add("hidden");
    await createTaskList(name);
  });

  // Edit Task Modal
  els.closeEditModal.addEventListener("click", closeEditModal);
  els.cancelEditBtn.addEventListener("click", closeEditModal);
  els.editModal.addEventListener("click", (e) => {
    if (e.target === els.editModal) closeEditModal();
  });

  els.editTaskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = els.editTaskId.value;
    await updateTaskDetails(id, {
      title: els.editTaskTitle.value,
      parent: els.editTaskParent ? els.editTaskParent.value : "",
      due: els.editTaskDue.value,
      notes: els.editTaskNotes.value
    });
    closeEditModal();
  });

  els.deleteTaskModalBtn.addEventListener("click", async () => {
    const id = els.editTaskId.value;
    closeEditModal();
    await deleteTask(id);
  });

  // Settings & Sync Controls
  const openSettings = () => els.settingsModal.classList.remove("hidden");
  els.settingsBtn.addEventListener("click", openSettings);
  els.syncBadge.addEventListener("click", openSettings);
  els.geminiTipBtn.addEventListener("click", openSettings);

  els.closeSettingsModal.addEventListener("click", () => {
    els.settingsModal.classList.add("hidden");
  });
  els.settingsModal.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) els.settingsModal.classList.add("hidden");
  });

  els.saveClientIdBtn.addEventListener("click", async () => {
    const id = els.oauthClientIdInput.value.trim();
    state.customClientId = id;
    if (typeof chrome !== "undefined" && chrome.storage) {
      await chrome.storage.sync.set({ customClientId: id });
    }
    showToast("Saved OAuth Client ID to Chrome Sync!");
  });

  els.connectGoogleBtn.addEventListener("click", connectGoogleInteractive);
  els.disconnectGoogleBtn.addEventListener("click", disconnectGoogle);

  els.refreshBtn.addEventListener("click", async () => {
    if (state.mode === "google" && state.authToken) {
      await syncWithGoogleTasks(false);
      showToast("Synced with Google Tasks");
    } else {
      await trySilentGoogleConnect();
    }
  });

  // GitHub Auto-Updater UI controls
  if (els.updateBannerBtn) {
    els.updateBannerBtn.addEventListener("click", openSettings);
  }

  if (els.checkUpdateBtn) {
    els.checkUpdateBtn.addEventListener("click", async () => {
      const repo = els.githubRepoInput.value.trim() || "Lifeender/TaskList";
      if (typeof chrome !== "undefined" && chrome.storage) {
        await chrome.storage.sync.set({ githubRepo: repo });
      }
      els.remoteVersionDisplay.textContent = "Checking GitHub...";
      chrome.runtime.sendMessage(
        { type: "CHECK_GITHUB_UPDATE", githubRepo: repo, githubBranch: "main" },
        (response) => {
          renderGitHubUpdateStatus(response);
          if (response && response.success) {
            showToast(
              response.updateAvailable
                ? `New update found on GitHub (${response.latestCommitSha || response.remoteVersion})!`
                : "Extension is up to date with GitHub!"
            );
          } else {
            showToast((response && response.error) || "Could not check GitHub.");
          }
        }
      );
    });
  }

  if (els.pullReloadBtn) {
    els.pullReloadBtn.addEventListener("click", () => {
      showToast("Triggering local git pull...");
      chrome.runtime.sendMessage({ type: "TRIGGER_LOCAL_GIT_PULL" }, (res) => {
        if (res && res.success) {
          if (res.reloaded) {
            showToast("Updated from GitHub! Reloading extension...");
          } else {
            // Even if files were already pulled by background script, mark current SHA & reload runtime
            chrome.storage.local.get(["githubUpdateStatus"], (st) => {
              if (st.githubUpdateStatus && st.githubUpdateStatus.latestCommitSha) {
                chrome.storage.local.set({
                  lastKnownCommitSha: st.githubUpdateStatus.latestCommitSha
                });
              }
              showToast(res.output || "Reloading extension...");
              setTimeout(() => chrome.runtime.reload(), 600);
            });
          }
        } else {
          // If local HTTP daemon isn't running, still reload extension in case git pull was done via scheduled task / terminal
          chrome.storage.local.get(["githubUpdateStatus"], (st) => {
            if (st.githubUpdateStatus && st.githubUpdateStatus.latestCommitSha) {
              chrome.storage.local.set({
                lastKnownCommitSha: st.githubUpdateStatus.latestCommitSha
              });
            }
            showToast("Reloading extension with latest local files...");
            setTimeout(() => chrome.runtime.reload(), 800);
          });
        }
      });
    });
  }
}
