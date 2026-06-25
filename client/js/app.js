// ═══════════════════════════════════════════════════
// ── Auth State ─────────────────────────────────────
// ═══════════════════════════════════════════════════
const AUTH_KEY = "todo_app_token";
let authToken = localStorage.getItem(AUTH_KEY);
let currentUser = null;

const $ = (sel) => document.querySelector(sel);

// ── API Helper ─────────────────────────────────────
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`/api${path}`, { headers, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}

// ── Auth Functions ─────────────────────────────────
function setAuth(token, user) {
  authToken = token; currentUser = user;
  localStorage.setItem(AUTH_KEY, token);
}
function clearAuth() {
  authToken = null; currentUser = null;
  localStorage.removeItem(AUTH_KEY);
}

async function checkAuth() {
  if (!authToken) return false;
  try { const d = await api("/auth/me"); currentUser = d.user; return true; }
  catch { clearAuth(); return false; }
}

async function handleAuthSubmit() {
  authError.textContent = "";
  try {
    const ep = authMode === "login" ? "/auth/login" : "/auth/register";
    const d = await api(ep, { method: "POST", body: JSON.stringify({
      username: authUsername.value.trim(), password: authPassword.value }) });
    setAuth(d.token, d.user);
    await enterApp();
  } catch (e) { authError.textContent = e.message; }
}

// ═══════════════════════════════════════════════════
// ── Todo State & API ───────────────────────────────
// ═══════════════════════════════════════════════════
let tasks = [];          // unified: my todos + shared todos
let pendingInvs = [];    // pending invitations
let currentFilter = "all";
let currentShareTodoId = null;

async function fetchTodos() {
  const d = await api("/todos");
  // Merge: own todos + shared todos into one display list
  const own = d.todos.map(t => ({ ...t, _own: true, _perm: "owner" }));
  const shared = d.shared.map(t => ({ ...t, _own: false, _perm: t.permission }));
  tasks = [...own, ...shared];
}

async function fetchInvitations() {
  const d = await api("/invitations");
  pendingInvs = d.invitations;
  updateInvitationsUI();
}

// ── Render ─────────────────────────────────────────
function render() {
  const filtered = tasks.filter(t => {
    if (currentFilter === "active")    return !t.done;
    if (currentFilter === "completed") return t.done;
    return true;
  });

  if (tasks.length === 0) emptyFilter.classList.remove("visible");
  else if (filtered.length === 0) emptyFilter.classList.add("visible");
  else emptyFilter.classList.remove("visible");

  taskList.innerHTML = filtered.map(t => {
    const ownerTag = !t._own ? `<span class="badge-owner">${t.owner_name}</span>` : "";
    const sharedTag = t.is_shared ? `<span class="badge-shared">👥 共享</span>` : "";
    const shareBtn = t._own
      ? `<button class="btn-share${t.is_shared ? ' is-shared' : ''}" title="共享管理" data-id="${t.id}">${t.is_shared ? '⚙️' : '🔗'}</button>`
      : "";

    return `
    <li class="task-item${t.done ? ' completed' : ''}" data-id="${t.id}">
      <label class="checkbox-wrap">
        <input type="checkbox" ${t.done ? 'checked' : ''} ${t._perm === 'read' ? 'disabled' : ''}>
        <span class="checkmark"></span>
      </label>
      <div class="task-meta">
        <span class="task-text">${escapeHtml(t.text)}</span>
        ${sharedTag}${ownerTag}
      </div>
      <div class="task-actions">
        ${shareBtn}
        ${t._own ? `<button class="btn-icon btn-edit" title="编辑"><span>✏️</span></button>` : ''}
        ${t._own ? `<button class="btn-icon btn-delete" title="删除"><span>🗑️</span></button>` : ''}
      </div>
    </li>`;
  }).join("");

  // Attach event listeners to buttons
  taskList.querySelectorAll(".task-item").forEach(li => {
    const id = li.dataset.id;
    const cb = li.querySelector("input[type=checkbox]");
    if (cb && !cb.disabled) cb.onchange = () => toggleTask(id);

    const shareBtn = li.querySelector(".btn-share");
    if (shareBtn) shareBtn.onclick = () => openShareModal(id);

    const editBtn = li.querySelector(".btn-edit");
    if (editBtn) editBtn.onclick = () => startEdit(id);

    const delBtn = li.querySelector(".btn-delete");
    if (delBtn) delBtn.onclick = () => removeTask(id);
  });

  // Stats
  const remaining = tasks.filter(t => !t.done).length;
  const total = tasks.length;
  if (total === 0) statsCount.innerHTML = "暂无任务";
  else if (remaining === 0) statsCount.innerHTML = "🎉 全部完成!";
  else statsCount.innerHTML = `共 <strong>${total}</strong> 项，还剩 <strong>${remaining}</strong> 项`;

  clearBtn.style.display = tasks.some(t => t.done && t._own) ? "" : "none";
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ── Task Actions (API) ─────────────────────────────
async function addTask() {
  const text = taskInput.value.trim();
  if (!text) { taskInput.focus(); return; }
  await api("/todos", { method: "POST", body: JSON.stringify({ text }) });
  taskInput.value = "";
  taskInput.focus();
  await fetchTodos();
  render();
}

async function toggleTask(id) {
  const t = tasks.find(t => t.id == id);
  if (!t || t._perm === "read") return;
  await api(`/todos/${id}`, { method: "PUT", body: JSON.stringify({ done: t.done ? 0 : 1 }) });
  await fetchTodos();
  render();
}

async function removeTask(id) {
  await api(`/todos/${id}`, { method: "DELETE" });
  if (currentShareTodoId == id) closeShareModal();
  await fetchTodos();
  render();
}

async function clearCompleted() {
  const doneTasks = tasks.filter(t => t.done && t._own);
  for (const t of doneTasks) await api(`/todos/${t.id}`, { method: "DELETE" });
  await fetchTodos();
  render();
}

function setFilter(filter) {
  currentFilter = filter;
  filterBtns.forEach(b => b.classList.toggle("active", b.dataset.filter === filter));
  render();
}

// ── Inline Edit ────────────────────────────────────
function startEdit(id) {
  const item = document.querySelector(`.task-item[data-id="${id}"]`);
  if (!item) return;
  const metaEl = item.querySelector(".task-meta");
  const textEl = metaEl.querySelector(".task-text");
  const t = tasks.find(t => t.id == id);
  if (!t) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "task-edit-input";
  input.value = t.text;
  input.maxLength = 200;
  textEl.replaceWith(input);
  input.focus(); input.select();

  const finish = async (save) => {
    const newText = input.value.trim();
    if (save && newText && newText !== t.text) {
      await api(`/todos/${id}`, { method: "PUT", body: JSON.stringify({ text: newText }) });
      await fetchTodos();
    }
    render();
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

// ═══════════════════════════════════════════════════
// ── Sharing ────────────────────────────────────────
// ═══════════════════════════════════════════════════
async function openShareModal(id) {
  currentShareTodoId = id;
  const t = tasks.find(t => t.id == id);
  if (!t) return;

  // If not shared yet, toggle sharing on first
  if (!t.is_shared) {
    await api(`/todos/${id}/share`, { method: "PUT" });
    await fetchTodos();
  }

  await loadShareModalData(id);
  shareModal.style.display = "flex";
  inviteUsername.focus();
}

function closeShareModal() {
  shareModal.style.display = "none";
  currentShareTodoId = null;
  inviteError.textContent = "";
  inviteUsername.value = "";
}

async function loadShareModalData(id) {
  const d = await api(`/todos/${id}/members`);
  const t = tasks.find(t => t.id == id);

  shareModalTitle.textContent = t?.is_shared ? "共享管理" : "成员管理";

  // Members
  if (d.members.length === 0) {
    memberList.innerHTML = '<p style="color:#9ca3af;font-size:.85rem;text-align:center">暂无成员</p>';
  } else {
    memberList.innerHTML = d.members.map(m => `
      <div class="member-item">
        <span class="member-name">👤 ${escapeHtml(m.username)}</span>
        <span class="member-role">${m.permission === 'read' ? '只读' : '可编辑'}</span>
        <button class="btn-remove-member" data-uid="${m.id}">移除</button>
      </div>
    `).join("");
    memberList.querySelectorAll(".btn-remove-member").forEach(btn => {
      btn.onclick = () => removeMember(id, btn.dataset.uid);
    });
  }
}

async function inviteUser() {
  const username = inviteUsername.value.trim();
  if (!username) return;
  inviteError.textContent = "";
  try {
    await api(`/todos/${currentShareTodoId}/invite`, {
      method: "POST", body: JSON.stringify({ username })
    });
    inviteUsername.value = "";
    await loadShareModalData(currentShareTodoId);
  } catch (e) { inviteError.textContent = e.message; }
}

async function removeMember(todoId, userId) {
  await api(`/todos/${todoId}/members/${userId}`, { method: "DELETE" });
  await loadShareModalData(todoId);
}

// ── Invitations ────────────────────────────────────
function updateInvitationsUI() {
  const count = pendingInvs.length;
  if (count > 0) {
    invitationsBtn.style.display = "";
    invitationsBtn.classList.add("has-pending");
    invitationsCount.textContent = count;
  } else {
    invitationsBtn.style.display = "none";
    invitationsBtn.classList.remove("has-pending");
    invitationsDropdown.style.display = "none";
  }
}

function toggleInvitationsDropdown() {
  if (pendingInvs.length === 0) return;
  const show = invitationsDropdown.style.display === "none";
  invitationsDropdown.style.display = show ? "" : "none";
  if (show) renderInvitationsDropdown();
}

function renderInvitationsDropdown() {
  invitationsDropdown.innerHTML = pendingInvs.map(inv => `
    <div class="invitation-item">
      <div class="inv-info">
        <div class="inv-text">📋 ${escapeHtml(inv.todo_text)}</div>
        <div class="inv-from">来自 ${escapeHtml(inv.inviter_name)}</div>
      </div>
      <div class="invitation-actions">
        <button class="btn-accept" data-iid="${inv.id}">接受</button>
        <button class="btn-reject" data-iid="${inv.id}">拒绝</button>
      </div>
    </div>
  `).join("") || '<p style="color:#9ca3af;font-size:.85rem;text-align:center;padding:16px">暂无邀请</p>';

  invitationsDropdown.querySelectorAll(".btn-accept").forEach(b => {
    b.onclick = () => respondInvitation(b.dataset.iid, true);
  });
  invitationsDropdown.querySelectorAll(".btn-reject").forEach(b => {
    b.onclick = () => respondInvitation(b.dataset.iid, false);
  });
}

async function respondInvitation(invId, accept) {
  await api(`/invitations/${invId}/respond`, { method: "POST", body: JSON.stringify({ accept }) });
  await fetchInvitations();
  await fetchTodos();
  render();
}

// ═══════════════════════════════════════════════════
// ── DOM Elements ───────────────────────────────────
// ═══════════════════════════════════════════════════
// Auth
const authSection  = $("#authSection");
const appSection   = $("#appSection");
const authTitle    = $("#authTitle");
const authUsername = $("#authUsername");
const authPassword = $("#authPassword");
const authError    = $("#authError");
const authSubmit   = $("#authSubmit");
const authToggle   = $("#authToggle");
const authSwitchText = $("#authSwitchText");
let authMode = "login";

// App
const displayName = $("#displayName");
const logoutBtn   = $("#logoutBtn");
const taskInput   = $("#taskInput");
const addBtn      = $("#addBtn");
const taskList    = $("#taskList");
const emptyFilter = $("#emptyFilter");
const statsCount  = $("#statsCount");
const clearBtn    = $("#clearCompleted");
const dateDisplay = $("#dateDisplay");
const filterBtns  = document.querySelectorAll("#appSection .filter-btn");

// Invitations
const invitationsBtn     = $("#invitationsBtn");
const invitationsCount   = $("#invitationsCount");
const invitationsDropdown = $("#invitationsDropdown");

// Share Modal
const shareModal      = $("#shareModal");
const shareModalTitle = $("#shareModalTitle");
const inviteUsername  = $("#inviteUsername");
const inviteBtn       = $("#inviteBtn");
const inviteError     = $("#inviteError");
const memberList      = $("#memberList");
const closeShareModalBtn = $("#closeShareModal");

// ═══════════════════════════════════════════════════
// ── Event Listeners ────────────────────────────────
// ═══════════════════════════════════════════════════
// Auth
authSubmit.addEventListener("click", handleAuthSubmit);
authPassword.addEventListener("keydown", e => { if (e.key === "Enter") handleAuthSubmit(); });
authToggle.addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  authTitle.textContent      = authMode === "login" ? "登录" : "注册";
  authSubmit.textContent     = authMode === "login" ? "登录" : "注册";
  authSwitchText.textContent = authMode === "login" ? "没有账号？" : "已有账号？";
  authToggle.textContent     = authMode === "login" ? "立即注册" : "去登录";
  authError.textContent = "";
});

logoutBtn.addEventListener("click", () => { clearAuth(); showAuth(); });

// Todo
addBtn.addEventListener("click", addTask);
taskInput.addEventListener("keydown", e => { if (e.key === "Enter") addTask(); });
filterBtns.forEach(btn => btn.addEventListener("click", () => setFilter(btn.dataset.filter)));
clearBtn.addEventListener("click", clearCompleted);

// Invitations
invitationsBtn.addEventListener("click", toggleInvitationsDropdown);

// Share Modal
closeShareModalBtn.addEventListener("click", closeShareModal);
shareModal.addEventListener("click", e => { if (e.target === shareModal) closeShareModal(); });
inviteBtn.addEventListener("click", inviteUser);
inviteUsername.addEventListener("keydown", e => { if (e.key === "Enter") inviteUser(); });

// ═══════════════════════════════════════════════════
// ── View Toggle ────────────────────────────────────
// ═══════════════════════════════════════════════════
function showAuth() {
  authSection.style.display = "";
  appSection.style.display = "none";
}

async function enterApp() {
  authSection.style.display = "none";
  appSection.style.display = "";
  displayName.textContent = `👤 ${currentUser.username}`;
  updateDate();
  await fetchTodos();
  await fetchInvitations();
  render();
}

function updateDate() {
  dateDisplay.textContent = new Date().toLocaleDateString("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
}

// ═══════════════════════════════════════════════════
// ── Init ───────────────────────────────────────────
// ═══════════════════════════════════════════════════
(async () => {
  const authed = await checkAuth();
  if (authed) await enterApp();
  else showAuth();
})();
