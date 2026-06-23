const state = {
  config: null,
  assets: [],
  selected: new Set(),
  filter: "all",
};

const $ = (id) => document.getElementById(id);
const THEME_STORAGE_KEY = "booth-import-manager-theme";
const PRESET_COLORS = [
  "#2563eb",
  "#059669",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#dc2626",
  "#65a30d",
  "#ca8a04",
  "#64748b",
];
const SPECIAL_UNTAGGED_TAG = "태그 없음";

function applyTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = normalized;
  $("themeToggleBtn").setAttribute("aria-pressed", normalized === "dark" ? "true" : "false");
  $("themeToggleText").textContent = normalized === "dark" ? "다크" : "라이트";
  localStorage.setItem(THEME_STORAGE_KEY, normalized);
}

function initTheme() {
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || "dark");
}

function setStatus(text) {
  $("statusText").textContent = text;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function tagOptionsHtml(current = "") {
  const tags = state.config?.tags || [];
  return [
    `<option value="">미지정</option>`,
    ...tags.map((tag) => `<option value="${escapeHtml(tag.name)}" ${tag.name === current ? "selected" : ""}>${escapeHtml(tag.name)}</option>`),
  ].join("");
}

function tagByName(name) {
  return (state.config?.tags || []).find((tag) => tag.name === name);
}

function statusLabel(status) {
  if (status === "imported") return "임포트 완료";
  if (status === "no_package") return "패키지 아님";
  return "임포트 안됨";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function filteredAssets() {
  if (state.filter === "untagged") return state.assets.filter((asset) => !asset.tag);
  if (state.filter === "tagged") return state.assets.filter((asset) => asset.tag);
  return state.assets;
}

function renderConfig() {
  const cfg = state.config;
  $("downloadFolderInput").value = cfg.downloadFolder;
  $("intakeFolderInput").value = cfg.intakeFolder;
  $("queueFolderInput").value = cfg.queueFolder;
  $("deleteAfterQueueInput").checked = cfg.deleteLocalAfterQueue;

  $("bulkTagSelect").innerHTML = tagOptionsHtml();

  $("presetColors").innerHTML = PRESET_COLORS.map((color) => `
    <button class="preset-btn" data-preset-color="${color}" title="${color}" style="background:${color}"></button>
  `).join("");

  $("tagList").innerHTML = cfg.tags.map((tag) => `
    <div class="tag-item">
      <input class="tag-color-input" type="color" value="${tag.color}" data-tag-color="${escapeHtml(tag.id)}" title="색상 수정" />
      <input class="tag-name-input" type="text" value="${escapeHtml(tag.name)}" data-tag-name="${escapeHtml(tag.id)}" title="이름 수정" ${tag.name === SPECIAL_UNTAGGED_TAG ? "readonly" : ""} />
      <button title="삭제" data-delete-tag="${escapeHtml(tag.id)}" ${tag.name === SPECIAL_UNTAGGED_TAG ? "disabled" : ""}>×</button>
    </div>
  `).join("");
}

function renderAssets() {
  const rows = $("assetRows");
  const assets = filteredAssets();
  $("emptyState").style.display = assets.length ? "none" : "block";
  $("selectAllInput").checked = assets.length > 0 && assets.every((asset) => state.selected.has(asset.filename));

  rows.innerHTML = assets.map((asset) => {
    const tag = tagByName(asset.tag);
    return `
      <tr data-row-select="${escapeHtml(asset.filename)}" class="${state.selected.has(asset.filename) ? "selected-row" : ""}">
        <td><input type="checkbox" data-select="${escapeHtml(asset.filename)}" ${state.selected.has(asset.filename) ? "checked" : ""}></td>
        <td title="${escapeHtml(asset.path)}">${escapeHtml(asset.filename)}</td>
        <td><span class="type-pill">${escapeHtml(asset.file_type)}</span></td>
        <td>${formatBytes(asset.size)}</td>
        <td><span class="status-pill status-${escapeHtml(asset.status || "pending")}">${statusLabel(asset.status)}</span></td>
        <td>
          <select data-tag-for="${escapeHtml(asset.filename)}">
            ${tagOptionsHtml(asset.tag)}
          </select>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadAll() {
  state.config = await api("/api/config");
  state.assets = await api("/api/assets");
  state.selected = new Set([...state.selected].filter((name) => state.assets.some((asset) => asset.filename === name)));
  renderConfig();
  renderAssets();
  setStatus(`${state.assets.length}개 파일`);
}

async function saveConfig() {
  const payload = {
    ...state.config,
    downloadFolder: $("downloadFolderInput").value.trim(),
    intakeFolder: $("intakeFolderInput").value.trim(),
    queueFolder: $("queueFolderInput").value.trim(),
    deleteLocalAfterQueue: $("deleteAfterQueueInput").checked,
  };
  await api("/api/config", { method: "POST", body: JSON.stringify(payload) });
  setStatus("설정 저장됨");
  await loadAll();
}

async function patchTag(filename, tag) {
  await api(`/api/assets/${encodeURIComponent(filename)}`, {
    method: "PATCH",
    body: JSON.stringify({ tag }),
  });
  const asset = state.assets.find((item) => item.filename === filename);
  if (asset) asset.tag = tag;
  renderAssets();
}

async function queueSelected() {
  const items = state.assets
    .filter((asset) => state.selected.has(asset.filename))
    .map((asset) => ({ filename: asset.filename, tag: asset.tag }));
  if (!items.length) return;
  const missingTag = items.find((item) => !item.tag);
  if (missingTag) {
    setStatus(`태그 필요: ${missingTag.filename}`);
    return;
  }
  const results = await api("/api/assets/queue", {
    method: "POST",
    body: JSON.stringify({ items, deleteLocal: $("deleteAfterQueueInput").checked }),
  });
  const errors = results.filter((result) => result.error);
  setStatus(errors.length ? `${errors.length}개 실패` : `${results.length}개 Unity 큐 추가`);
  await loadAll();
}

async function hideSelected() {
  const names = [...state.selected];
  if (!names.length) return;
  await api("/api/assets/hide", {
    method: "POST",
    body: JSON.stringify({ filenames: names }),
  });
  state.selected.clear();
  setStatus(`${names.length}개 목록에서 지움`);
  await loadAll();
}

async function deleteSelected() {
  const names = [...state.selected];
  for (const name of names) {
    await api(`/api/assets/${encodeURIComponent(name)}`, { method: "DELETE" });
  }
  state.selected.clear();
  setStatus(`${names.length}개 삭제됨`);
  await loadAll();
}

async function addTag() {
  const name = $("newTagNameInput").value.trim();
  if (!name) return;
  state.config.tags.push({
    id: crypto.randomUUID(),
    name,
    color: $("newTagColorInput").value,
  });
  $("newTagNameInput").value = "";
  await api("/api/config", { method: "POST", body: JSON.stringify(state.config) });
  await loadAll();
}

async function saveTags() {
  await api("/api/config", { method: "POST", body: JSON.stringify(state.config) });
  await loadAll();
}

async function renameTag(id, nextName) {
  const tag = state.config.tags.find((item) => item.id === id);
  if (!tag) return;
  if (tag.name === SPECIAL_UNTAGGED_TAG) {
    renderConfig();
    return;
  }
  if (nextName === SPECIAL_UNTAGGED_TAG) {
    renderConfig();
    setStatus("'태그 없음'은 기본 태그로만 사용됩니다");
    return;
  }
  const oldName = tag.name;
  tag.name = nextName;
  await api("/api/config", { method: "POST", body: JSON.stringify(state.config) });
  const affected = state.assets.filter((asset) => asset.tag === oldName);
  for (const asset of affected) {
    await patchTag(asset.filename, nextName);
  }
  await loadAll();
}

async function deleteTag(id) {
  state.config.tags = state.config.tags.filter((tag) => tag.id !== id || tag.name === SPECIAL_UNTAGGED_TAG);
  await saveTags();
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  const row = target.closest("[data-row-select]");
  if (row && !target.closest("input, select, button")) {
    const filename = row.dataset.rowSelect;
    if (state.selected.has(filename)) state.selected.delete(filename);
    else state.selected.add(filename);
    renderAssets();
    return;
  }
  if (target.matches("[data-delete-tag]")) {
    await deleteTag(target.dataset.deleteTag);
  }
  if (target.matches("[data-preset-color]")) {
    $("newTagColorInput").value = target.dataset.presetColor;
  }
});

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.matches("[data-select]")) {
    if (target.checked) state.selected.add(target.dataset.select);
    else state.selected.delete(target.dataset.select);
    renderAssets();
  }
  if (target.matches("[data-tag-for]")) {
    await patchTag(target.dataset.tagFor, target.value);
  }
  if (target.matches("[data-tag-color]")) {
    const tag = state.config.tags.find((item) => item.id === target.dataset.tagColor);
    if (!tag) return;
    tag.color = target.value;
    await saveTags();
  }
  if (target.matches("[data-tag-name]")) {
    const nextName = target.value.trim();
    if (!nextName) {
      renderConfig();
      return;
    }
    await renameTag(target.dataset.tagName, nextName);
  }
});

$("selectAllInput").addEventListener("change", (event) => {
  const assets = filteredAssets();
  if (event.target.checked) assets.forEach((asset) => state.selected.add(asset.filename));
  else assets.forEach((asset) => state.selected.delete(asset.filename));
  renderAssets();
});

document.querySelectorAll(".segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.filter = button.dataset.filter;
    renderAssets();
  });
});

$("refreshBtn").addEventListener("click", loadAll);
$("themeToggleBtn").addEventListener("click", () => {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});
$("saveConfigBtn").addEventListener("click", saveConfig);
$("queueBtn").addEventListener("click", queueSelected);
$("hideBtn").addEventListener("click", hideSelected);
$("deleteBtn").addEventListener("click", deleteSelected);
$("addTagBtn").addEventListener("click", addTag);
$("applyTagBtn").addEventListener("click", async () => {
  const tag = $("bulkTagSelect").value;
  for (const filename of state.selected) {
    await patchTag(filename, tag);
  }
  setStatus(`${state.selected.size}개 태그 적용`);
});

initTheme();
loadAll().catch((error) => setStatus(`오류: ${error.message}`));
