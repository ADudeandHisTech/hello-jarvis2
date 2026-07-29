"use strict";

const APP = {
  name: "JARVIS Mobile Command Center V1",
  schemaVersion: "1.0",
  dbName: "jarvis-mcc-v1",
  dbVersion: 1,
  db: null,
  items: [],
  activeView: "home",
  deferredInstallPrompt: null,
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(APP.dbName, APP.dbVersion);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
      if (!db.objectStoreNames.contains("attachments")) db.createObjectStore("attachments", { keyPath: "id" });
    };
    request.onsuccess = () => { APP.db = request.result; resolve(APP.db); };
    request.onerror = () => reject(request.error);
  });
}

function storeRequest(storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = APP.db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllItems() {
  APP.items = await storeRequest("items", "readonly", (store) => store.getAll());
  APP.items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function putItem(item) {
  await storeRequest("items", "readwrite", (store) => store.put(item));
  await getAllItems();
  renderAll();
}

async function putAttachment(file) {
  if (!file || !file.size) return null;
  const id = `ATT-${crypto.randomUUID()}`;
  const record = { id, name: file.name, type: file.type, size: file.size, createdAt: new Date().toISOString(), blob: file };
  await storeRequest("attachments", "readwrite", (store) => store.put(record));
  return { id, name: file.name, type: file.type, size: file.size };
}

async function viewAttachment(id) {
  const attachment = await storeRequest("attachments", "readonly", (store) => store.get(id));
  if (!attachment) return toast("Attachment is not available on this device.");
  const url = URL.createObjectURL(attachment.blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function makeId(prefix = "MCC") {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function clean(value) { return typeof value === "string" ? value.trim() : value; }
function displayDate(value) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "—"; }
function displayDateTime(value) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }

function baseItem({ module, type, title, description, priority = "Medium", dueDate = "", assignedIdentity = "JARVIS", approvalState = "NOT_REQUIRED_LOCAL", status = "OPEN", permissionTier = "TIER-0 LOCAL RECORD", fields = {}, attachments = [] }) {
  const now = new Date().toISOString();
  return {
    schemaVersion: APP.schemaVersion,
    id: makeId(module.replace(/\s/g, "").slice(0, 4).toUpperCase()),
    commandOwner: "JARVIS",
    returnTo: "JARVIS",
    module,
    type,
    title: clean(title),
    description: clean(description),
    priority,
    dueDate,
    assignedIdentity,
    approvalState,
    status,
    permissionTier,
    fields,
    attachments,
    createdAt: now,
    updatedAt: now,
    statusHistory: [{ status, at: now, by: "Jake / Mobile Operator" }],
  };
}

async function saveForm(form, config) {
  const data = new FormData(form);
  const file = data.get("attachment");
  const attachment = file instanceof File && file.size ? await putAttachment(file) : null;
  const fields = {};
  for (const [key, value] of data.entries()) {
    if (key !== "attachment" && !["title", "details", "priority", "dueDate"].includes(key)) fields[key] = clean(value);
  }
  const item = baseItem({
    module: config.module,
    type: config.type(data),
    title: data.get("title"),
    description: data.get("details"),
    priority: data.get("priority") || config.priority?.(data) || "Medium",
    dueDate: data.get("dueDate") || "",
    assignedIdentity: config.identity,
    approvalState: config.approval || "NOT_REQUIRED_LOCAL",
    status: config.status || "OPEN",
    permissionTier: config.permission || "TIER-0 LOCAL RECORD",
    fields,
    attachments: attachment ? [attachment] : [],
  });
  await putItem(item);
  form.reset();
  toast(`${config.module} record saved.`);
  switchView("home");
}

function routeCommand(command) {
  const text = command.toLowerCase();
  const routes = [
    { identity: "Ratchet", terms: ["error", "broken", "troubleshoot", "washer", "refrigerator", "computer", "phone", "wifi", "repair", "service problem"], reason: "Technical troubleshooting or equipment service" },
    { identity: "Soundwave", terms: ["video", "media", "edit", "footage", "organize photos", "audio"], reason: "Media intake, classification, or production" },
    { identity: "VISION", terms: ["inspect image", "review photo", "analyze picture", "visual", "look at this"], reason: "Visual review and decision support" },
    { identity: "Ironhide", terms: ["ranch", "animal", "deer", "fence", "gate", "feeder", "water", "tractor", "equipment", "field"], reason: "Ranch operations and logistics" },
    { identity: "Optimus", terms: ["drone business", "client", "lead", "quote", "proposal", "mapping job", "invoice", "business", "revenue"], reason: "Business prioritization and client work" },
    { identity: "C-3PO", terms: ["email", "receipt", "warranty", "appointment", "paperwork", "admin", "claim", "schedule service", "call"], reason: "Administrative records and communications" },
    { identity: "CAPTAIN", terms: ["morning brief", "news", "headlines", "daily briefing"], reason: "News and morning briefing" },
    { identity: "Alfred", terms: ["personal", "family", "remind me", "calendar", "household"], reason: "Personal assistance and concierge support" },
  ];
  let best = { identity: "JARVIS", score: 0, reason: "General command; JARVIS remains the primary owner" };
  for (const route of routes) {
    const score = route.terms.reduce((sum, term) => sum + (text.includes(term) ? term.length : 0), 0);
    if (score > best.score) best = { ...route, score };
  }
  return { ...best, permission: "TIER-1 REVIEW", approval: "PENDING_OPERATOR_APPROVAL" };
}

function switchView(view) {
  APP.activeView = view;
  $$(".view").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  $$(".bottom-nav button").forEach(el => el.classList.toggle("active", el.dataset.openView === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "review") renderReview();
}

function activeItems() { return APP.items.filter(i => i.status !== "ARCHIVED"); }

function renderStats() {
  const today = new Date().toDateString();
  $("#statOpen").textContent = APP.items.filter(i => !["COMPLETED", "ARCHIVED"].includes(i.status)).length;
  $("#statReview").textContent = APP.items.filter(i => i.approvalState === "PENDING_OPERATOR_APPROVAL" || i.status === "PENDING_REVIEW").length;
  $("#statHigh").textContent = activeItems().filter(i => i.priority === "High").length;
  $("#statDone").textContent = APP.items.filter(i => i.status === "COMPLETED" && new Date(i.updatedAt).toDateString() === today).length;
}

function recordHtml(item, compact = false) {
  const description = compact ? item.description.slice(0, 100) : item.description;
  const attachmentButtons = (item.attachments || []).map(a => `<button data-action="attachment" data-attachment-id="${escapeHtml(a.id)}">View ${escapeHtml(a.name)}</button>`).join("");
  const controls = compact ? "" : `<div class="record-actions">
    ${item.approvalState === "PENDING_OPERATOR_APPROVAL" ? `<button class="approve" data-action="approve" data-id="${item.id}">Approve</button><button class="return" data-action="return" data-id="${item.id}">Return</button>` : ""}
    ${item.status !== "COMPLETED" && item.status !== "ARCHIVED" ? `<button class="complete" data-action="complete" data-id="${item.id}">Complete</button>` : ""}
    ${item.status !== "ARCHIVED" ? `<button class="archive" data-action="archive" data-id="${item.id}">Archive</button>` : ""}
    ${attachmentButtons}
  </div>`;
  return `<article class="record-card ${item.priority === "High" ? "high" : ""}">
    <div class="record-top"><span class="module-badge">${escapeHtml(item.module)}</span><span class="status-badge">${escapeHtml(item.status.replaceAll("_", " "))}</span></div>
    <h4>${escapeHtml(item.title)}</h4>
    <p>${escapeHtml(description || "No additional details.")}</p>
    <div class="record-meta"><span>${escapeHtml(item.assignedIdentity)}</span><span>${escapeHtml(item.priority)} priority</span><span>${displayDateTime(item.createdAt)}</span>${item.dueDate ? `<span>Due ${displayDate(item.dueDate)}</span>` : ""}</div>
    ${controls}
  </article>`;
}

function renderRecent() {
  const recent = activeItems().slice(0, 4);
  const container = $("#recentList");
  if (!recent.length) { container.className = "record-list empty-state"; container.textContent = "No records yet."; return; }
  container.className = "record-list";
  container.innerHTML = recent.map(item => recordHtml(item, true)).join("");
}

function reviewMatches(item) {
  const status = $("#filterStatus")?.value || "ACTIVE";
  const module = $("#filterModule")?.value || "ALL";
  const query = ($("#searchRecords")?.value || "").toLowerCase();
  const statusMatch = status === "ALL" || (status === "ACTIVE" ? !["COMPLETED", "ARCHIVED"].includes(item.status) : (status === "PENDING_REVIEW" ? (item.status === "PENDING_REVIEW" || item.approvalState === "PENDING_OPERATOR_APPROVAL") : item.status === status));
  const moduleMatch = module === "ALL" || item.module === module;
  const haystack = `${item.title} ${item.description} ${item.module} ${item.assignedIdentity}`.toLowerCase();
  return statusMatch && moduleMatch && (!query || haystack.includes(query));
}

function renderReview() {
  const items = APP.items.filter(reviewMatches);
  const container = $("#reviewList");
  if (!items.length) { container.className = "record-list empty-state"; container.textContent = "No records match this filter."; return; }
  container.className = "record-list";
  container.innerHTML = items.map(item => recordHtml(item)).join("");
}

function renderAll() { renderStats(); renderRecent(); if (APP.activeView === "review") renderReview(); }

async function updateItemStatus(id, action) {
  const item = APP.items.find(i => i.id === id);
  if (!item) return;
  const now = new Date().toISOString();
  if (action === "approve") { item.approvalState = "APPROVED_BY_OPERATOR"; item.status = "APPROVED"; }
  if (action === "return") { item.approvalState = "RETURNED_FOR_REVISION"; item.status = "PENDING_REVIEW"; }
  if (action === "complete") item.status = "COMPLETED";
  if (action === "archive") item.status = "ARCHIVED";
  item.updatedAt = now;
  item.statusHistory.push({ status: item.status, approvalState: item.approvalState, at: now, by: "Jake / Mobile Operator" });
  await putItem(item);
  toast(`Record ${action}d.`);
}

function createDownload(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportObject() {
  return { app: APP.name, schemaVersion: APP.schemaVersion, exportedAt: new Date().toISOString(), operator: "Jake", recordCount: APP.items.length, note: "Attachment blobs remain on the originating device; attachment metadata is included.", items: APP.items };
}

function markdownReport() {
  const lines = [`# JARVIS Mobile Command Center Report`, ``, `Generated: ${new Date().toLocaleString()}`, `Records: ${APP.items.length}`, ``, `## Status Summary`, ``, `- Open: ${APP.items.filter(i => !["COMPLETED", "ARCHIVED"].includes(i.status)).length}`, `- Pending operator review: ${APP.items.filter(i => i.approvalState === "PENDING_OPERATOR_APPROVAL").length}`, `- High priority active: ${activeItems().filter(i => i.priority === "High").length}`, `- Completed: ${APP.items.filter(i => i.status === "COMPLETED").length}`, ``];
  for (const item of APP.items) {
    lines.push(`## ${item.title}`, ``, `- ID: ${item.id}`, `- Module: ${item.module}`, `- Assigned identity: ${item.assignedIdentity}`, `- Priority: ${item.priority}`, `- Status: ${item.status}`, `- Approval: ${item.approvalState}`, `- Created: ${item.createdAt}`, item.dueDate ? `- Due: ${item.dueDate}` : `- Due: none`, ``, item.description || "No details.", ``);
  }
  return lines.join("\n");
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

async function importRecords(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.items)) throw new Error("No items array found");
    let imported = 0;
    for (const item of data.items) {
      if (!item.id || !item.title || !item.module) continue;
      const existing = APP.items.find(i => i.id === item.id);
      if (!existing) { await storeRequest("items", "readwrite", store => store.put(item)); imported++; }
    }
    await getAllItems(); renderAll(); toast(`${imported} record${imported === 1 ? "" : "s"} imported.`);
  } catch (error) { toast(`Import failed: ${error.message}`); }
}

function setDaypart() {
  const hour = new Date().getHours();
  $("#daypart").textContent = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

function registerEvents() {
  $$('[data-open-view]').forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.openView)));
  $$(".back-button").forEach(btn => btn.addEventListener("click", () => switchView("home")));
  $("#homeButton").addEventListener("click", () => switchView("home"));
  $("#settingsButton").addEventListener("click", () => switchView("settings"));
  $("#urgentButton").addEventListener("click", () => { switchView("capture"); $("#captureForm [name=priority]").value = "High"; $("#captureForm [name=captureType]").value = "Problem"; setTimeout(() => $("#captureForm [name=title]").focus(), 150); });

  $("#captureForm").addEventListener("submit", e => { e.preventDefault(); saveForm(e.currentTarget, { module: "Capture", type: d => d.get("captureType"), identity: "JARVIS" }); });
  $("#ranchForm").addEventListener("submit", e => { e.preventDefault(); saveForm(e.currentTarget, { module: "Ranch", type: d => d.get("category"), identity: "Ironhide", priority: d => d.get("severity") === "Urgent" ? "High" : d.get("severity") === "Routine" ? "Low" : "Medium" }); });
  $("#droneForm").addEventListener("submit", e => { e.preventDefault(); saveForm(e.currentTarget, { module: "Drone Business", type: d => d.get("recordType"), identity: "Optimus" }); });
  $("#adminForm").addEventListener("submit", e => { e.preventDefault(); saveForm(e.currentTarget, { module: "Admin", type: d => d.get("category"), identity: "C-3PO" }); });

  $("#jarvisCommand").addEventListener("input", e => {
    const route = routeCommand(e.target.value);
    $("#routeIdentity").textContent = route.identity;
    $("#routePermission").textContent = route.permission;
    $("#routeReason").textContent = route.reason;
  });
  $("#askForm").addEventListener("submit", async e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const command = clean(data.get("command"));
    const route = routeCommand(command);
    const title = command.length > 72 ? `${command.slice(0, 69)}...` : command;
    const item = baseItem({ module: "Ask JARVIS", type: "Routed command", title, description: command, priority: data.get("priority"), dueDate: data.get("dueDate"), assignedIdentity: route.identity, approvalState: route.approval, status: "PENDING_REVIEW", permissionTier: route.permission, fields: { routingReason: route.reason } });
    await putItem(item); e.currentTarget.reset(); $("#routeIdentity").textContent = "JARVIS"; $("#routeReason").textContent = "Enter a command to preview classification."; toast(`Task routed to ${route.identity} for approval.`); switchView("review");
  });

  ["#filterStatus", "#filterModule", "#searchRecords"].forEach(s => $(s).addEventListener("input", renderReview));
  $("#reviewList").addEventListener("click", e => {
    const btn = e.target.closest("button[data-action]"); if (!btn) return;
    if (btn.dataset.action === "attachment") viewAttachment(btn.dataset.attachmentId);
    else updateItemStatus(btn.dataset.id, btn.dataset.action);
  });
  $("#exportJson").addEventListener("click", () => createDownload(JSON.stringify(exportObject(), null, 2), `JARVIS_MCC_Backup_${new Date().toISOString().slice(0,10)}.json`, "application/json"));
  $("#exportBackup").addEventListener("click", () => createDownload(JSON.stringify(exportObject(), null, 2), `JARVIS_MCC_Backup_${new Date().toISOString().slice(0,10)}.json`, "application/json"));
  $("#exportMarkdown").addEventListener("click", () => createDownload(markdownReport(), `JARVIS_MCC_Report_${new Date().toISOString().slice(0,10)}.md`, "text/markdown"));
  $("#shareReport").addEventListener("click", async () => {
    const summary = `JARVIS MCC: ${APP.items.length} records; ${APP.items.filter(i => !["COMPLETED", "ARCHIVED"].includes(i.status)).length} open; ${APP.items.filter(i => i.approvalState === "PENDING_OPERATOR_APPROVAL").length} pending approval.`;
    if (navigator.share) { try { await navigator.share({ title: "JARVIS Command Center Summary", text: summary }); } catch (_) {} }
    else { await navigator.clipboard.writeText(summary); toast("Summary copied."); }
  });
  $("#importJson").addEventListener("change", e => { if (e.target.files[0]) importRecords(e.target.files[0]); e.target.value = ""; });
  $("#installButton").addEventListener("click", async () => {
    if (APP.deferredInstallPrompt) { APP.deferredInstallPrompt.prompt(); await APP.deferredInstallPrompt.userChoice; APP.deferredInstallPrompt = null; }
    else $("#installDialog").showModal();
  });
  $("#closeInstall").addEventListener("click", () => $("#installDialog").close());
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); APP.deferredInstallPrompt = e; });
}

async function init() {
  setDaypart(); registerEvents();
  try { await openDatabase(); await getAllItems(); renderAll(); }
  catch (error) { console.error(error); toast("Local database could not be opened."); }
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("service-worker.js").catch(console.error);
}

document.addEventListener("DOMContentLoaded", init);
