const API_URL = "https://script.google.com/macros/s/AKfycbz6TO2XWbrDusq3wajJ_kbO6lz0U0Zx4mHtwcGfjNTLi0YKFm5Dl1lJNAcI71nvV0BEoA/exec"

let dashboardData = null;
let controllerToken = null;
let controllerOperator = null;
let selectedTask = null;
let refreshTimer = null;

const $ = id => document.getElementById(id);
const setText = (id, value) => { const e = $(id); if (e) e.textContent = value ?? ""; };
const setValue = (id, value) => { const e = $(id); if (e) e.value = value ?? ""; };
const getValue = id => $(id)?.value ?? "";

async function apiGet(action) {
  const url = `${API_URL}?action=${encodeURIComponent(action)}`;
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "API request failed.");
  return data;
}

async function apiPost(payload) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.message || "API request failed.");
  return data;
}

async function loadDashboard() {
  try {
    const data = await apiGet("dashboard");
    dashboardData = data;
    renderDashboard(data);
    scheduleRefresh(data);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Unable to load reactor telemetry.", "error");
  }
}

function renderDashboard(data) {
  const system = data.system || {};
  renderSystem(system);
  renderStatistics(data.statistics || {});
  renderTasks(data.tasks || []);
}

function renderSystem(config) {
  setText("systemName", config.systemName || "PRISMATIC REACTOR CONTROL");
  setText("reactorId", `${config.reactorId || "PRC-01"} · CONTROL NETWORK`);
  setText("systemStatus", config.systemStatus || "ONLINE");
}

function renderStatistics(stats) {
  setText("statTotal", stats.total || 0);
  setText("statPending", stats.pending || 0);
  setText("statActive", stats.active || 0);
  setText("statCompleted", stats.completed || 0);
  setText("statCritical", stats.critical || 0);
  setText("statOverdue", stats.overdue || 0);
  const percentage = Math.max(0, Math.min(100, Number(stats.completionPercentage || 0)));
  setText("completionPercentage", `${Math.round(percentage)}%`);
  setText("completionText", `${stats.completed || 0} / ${stats.total || 0}`);
  const bar = $("completionBar");
  if (bar) bar.style.width = `${percentage}%`;
}

function renderTasks(tasks) {
  const container = $("taskList");
  if (!container) return;
  if (!tasks.length) {
    container.innerHTML = '<div class="empty-state">No reactor operations are currently registered.</div>';
    return;
  }
  container.innerHTML = tasks.map(createTaskCard).join("");
}

function createTaskCard(task) {
  const state = String(task.systemState || "NORMAL").toUpperCase();
  const stateClass = ({ OVERDUE: "overdue", CRITICAL: "critical", CAUTION: "caution", ACTIVE: "active", STABLE: "completed" })[state] || "";
  const labels = { OVERDUE: "DEADLINE BREACH", CRITICAL: "CRITICAL", CAUTION: "CAUTION", ACTIVE: "ACTIVE OPERATION", STABLE: "STABLE", NORMAL: "STANDBY" };
  const due = formatDeadline(task);
  return `<article class="task-card ${stateClass}" data-task-id="${escapeHtml(task.taskId || "")}" onclick="openTaskController('${escapeAttribute(task.taskId || "")}')">
    <div class="task-indicator"></div><div class="task-main">
      <div class="task-title-row"><span class="task-id">${escapeHtml(task.taskId || "")}</span><h3 class="task-title">${escapeHtml(task.name || "Unnamed Operation")}</h3></div>
      <p class="task-description">${escapeHtml(task.description || "No operational description available.")}</p>
      <div class="task-meta"><span>Priority: <strong>${escapeHtml(task.priority || "Low")}</strong></span><span>Assigned: <strong>${escapeHtml(task.assignedTo || "Unassigned")}</strong></span>${task.category ? `<span>${escapeHtml(task.category)}</span>` : ""}</div>
    </div><div class="task-right"><div class="task-state">${labels[state] || "STANDBY"}</div><div class="task-time">${escapeHtml(due)}</div></div>
  </article>`;
}

function formatDeadline(task) {
  if (task.timeRemaining) {
    const t = task.timeRemaining;
    const prefix = t.overdue ? "OVERDUE · " : "T-";
    if (t.days) return `${prefix}${t.days}d ${t.hours}h ${t.minutes}m`;
    return `${prefix}${String(t.hours).padStart(2,"0")}h ${String(t.minutes).padStart(2,"0")}m`;
  }
  if (task.dueDate) return task.dueTime ? `${task.dueDate} · ${task.dueTime}` : task.dueDate;
  return "No deadline";
}

function openController() {
  if (controllerToken) return openControllerRoom();
  openModal("authModal");
  setTimeout(() => $("controllerPassword")?.focus(), 100);
}

function openTaskController(taskId) {
  selectedTask = dashboardData?.tasks?.find(t => String(t.taskId) === String(taskId));
  if (!selectedTask) return showToast("Task could not be located.", "error");
  if (!controllerToken) { openModal("authModal"); setTimeout(() => $("controllerPassword")?.focus(), 100); return; }
  openControllerRoom();
}

async function authenticate() {
  const input = $("controllerPassword");
  const password = input?.value || "";
  if (!password) return showToast("Enter the controller password.", "warning");
  const button = $("authenticateButton");
  button.disabled = true; button.textContent = "Authenticating...";
  try {
    const result = await apiPost({ action: "authenticate", password });
    controllerToken = result.token;
    controllerOperator = result.operator;
    input.value = "";
    closeModal("authModal");
    showToast("Controller authentication successful.", "success");
    if (selectedTask) openControllerRoom();
  } catch (error) { input.value = ""; showToast(error.message || "Authentication failed.", "error"); }
  finally { button.disabled = false; button.textContent = "Authenticate"; }
}

function handlePasswordKey(event) { if (event.key === "Enter") { event.preventDefault(); authenticate(); } }

function openControllerRoom() {
  if (!controllerToken) return openController();
  if (!selectedTask) return showToast("Select an operation first.", "warning");
  populateControllerForm(); openModal("controllerModal");
}

function populateControllerForm() {
  const t = selectedTask;
  setValue("editTask", t.name); setValue("editDescription", t.description); setValue("editStatus", t.status || "Pending");
  setValue("editPriority", t.priority || "Low"); setValue("editNotes", t.notes || ""); setValue("editDueDate", normalizeDateInput(t.dueDate)); setValue("editDueTime", normalizeTimeInput(t.dueTime));
  setText("controllerOperator", `Operator: ${controllerOperator || "AUTHORIZED"}`);
}

async function saveTask() {
  if (!controllerToken || !selectedTask) return showToast("No authorized operation selected.", "warning");
  const button = $("saveButton"); button.disabled = true; button.textContent = "Saving...";
  const updates = { "Task": getValue("editTask"), "Description": getValue("editDescription"), "Status": getValue("editStatus"), "Priority": getValue("editPriority"), "Due Date": getValue("editDueDate"), "Due Time": getValue("editDueTime"), "Notes": getValue("editNotes") };
  try { await apiPost({ action: "updateTask", token: controllerToken, taskId: selectedTask.taskId, updates }); closeModal("controllerModal"); showToast("Operation updated successfully.", "success"); await loadDashboard(); }
  catch (error) { showToast(error.message || "Unable to update operation.", "error"); if (/session|authentication/i.test(error.message || "")) lockController(); }
  finally { button.disabled = false; button.textContent = "Save Changes"; }
}

async function completeSelectedTask() {
  if (!controllerToken || !selectedTask) return showToast("No authorized operation selected.", "warning");
  try { await apiPost({ action: "completeTask", token: controllerToken, taskId: selectedTask.taskId }); closeModal("controllerModal"); showToast("Operation marked as completed.", "success"); await loadDashboard(); }
  catch (error) { showToast(error.message || "Unable to complete operation.", "error"); }
}

async function logout() {
  const token = controllerToken; lockController();
  if (token) { try { await apiPost({ action: "logout", token }); } catch (e) { console.error(e); } }
  showToast("Controller room locked.", "success");
}
function lockController() { controllerToken = null; controllerOperator = null; selectedTask = null; closeModal("controllerModal"); }
function openModal(id) { $(id)?.classList.add("active"); }
function closeModal(id) { $(id)?.classList.remove("active"); }
function scheduleRefresh(data) { clearTimeout(refreshTimer); const ms = Number(data.system?.refreshInterval) || 30000; refreshTimer = setTimeout(loadDashboard, ms); }

function startClock() { updateClock(); setInterval(updateClock, 1000); }
function updateClock() {
  const now = new Date();
  setText("liveClock", new Intl.DateTimeFormat("en-IN", { timeZone:"Asia/Kolkata", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(now));
  setText("liveDate", `${new Intl.DateTimeFormat("en-IN", { timeZone:"Asia/Kolkata", weekday:"long", day:"2-digit", month:"short", year:"numeric" }).format(now)} · IST`);
}
function showToast(message, type="") { const c=$("toastContainer"); if(!c)return; const t=document.createElement("div"); t.className=`toast ${type}`; t.textContent=message; c.appendChild(t); setTimeout(()=>{t.classList.add("hide");setTimeout(()=>t.remove(),250)},3500); }
function normalizeDateInput(v){ if(!v)return ""; const s=String(v); if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s; const d=new Date(v); if(Number.isNaN(d.getTime()))return ""; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function normalizeTimeInput(v){ if(!v)return ""; const s=String(v); if(/^\d{2}:\d{2}$/.test(s))return s.slice(0,5); const d=new Date(v); if(Number.isNaN(d.getTime()))return ""; return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function escapeHtml(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function escapeAttribute(v){return String(v??"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");}

document.addEventListener("DOMContentLoaded", () => { startClock(); loadDashboard(); });
document.addEventListener("click", e => { if(e.target.classList?.contains("modal")) e.target.classList.remove("active"); });
