import { localApi, ping } from "../lib/local.js";

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};
const send = (type, payload = {}) =>
  new Promise((resolve, reject) =>
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error || "응답 없음"));
      resolve(res.data);
    }),
  );

const STATUS_TEXT = { pending: "대기", queued: "대기", imported: "임포트됨", failed: "실패", no_package: "패키지 없음", downloaded: "받음", cancelled: "취소" };
const UNTAGGED = "태그 없음";

const state = {
  online: false,
  config: null,
  projects: [],
  assets: [],
  selected: new Set(),
  project: "",
  tag: "",
  lastTagByProject: {},
  wishScan: null,
};

// ---- 연결 / 로드 ------------------------------------------------------------
async function load() {
  const alive = await ping();
  state.online = alive.ok;
  $("conn").querySelector(".dot").className = `dot ${alive.ok ? "on" : "off"}`;
  $("connText").textContent = alive.ok ? `연결됨 v${alive.version}` : "꺼짐";
  $("offline").classList.toggle("hidden", alive.ok);
  $("target").classList.toggle("hidden", !alive.ok);
  if (!alive.ok) {
    $("fileList").replaceChildren(h("div", { class: "empty", text: "로컬 앱 연결 후 표시돼요" }));
    return;
  }
  const [config, projects, assets, prefs] = await Promise.all([
    localApi("/api/config"),
    localApi("/api/projects?all=0"),
    localApi("/api/assets?all=1"),
    chrome.storage.local.get(["lastProject", "lastTagByProject"]),
  ]);
  state.config = config;
  state.projects = projects;
  state.assets = assets;
  state.lastTagByProject = prefs.lastTagByProject || {};
  if (!state.project || !projects.some((p) => p.key === state.project)) state.project = prefs.lastProject || "";
  state.selected = new Set([...state.selected].filter((f) => assets.some((a) => a.filename === f)));
  renderTarget();
  renderFiles();
  if (!$("tab-queue").classList.contains("hidden")) renderQueue();
}

// ---- 1. 프로젝트 / 2. 태그 ---------------------------------------------------
function tagsFor(projectKey) {
  const all = state.config?.tags || [];
  const project = state.projects.find((p) => p.key === projectKey);
  if (!project || !Array.isArray(project.tags)) return all;
  const allowed = new Set(project.tags);
  return all.filter((t) => allowed.has(t.id) || t.name === UNTAGGED);
}

function renderTarget() {
  const sel = $("projectSel");
  sel.replaceChildren(h("option", { value: "", text: state.projects.length ? "유니티 프로젝트 선택" : "프로젝트 없음 — 관리에서 폴더 등록" }));
  for (const p of state.projects) {
    sel.append(h("option", { value: p.key, text: `${p.running ? "●" : "○"} ${p.name}${p.pending ? `  (대기 ${p.pending})` : ""}` }));
  }
  sel.value = state.projects.some((p) => p.key === state.project) ? state.project : "";
  state.project = sel.value;

  const tagSel = $("tagSel");
  const tags = tagsFor(state.project);
  tagSel.replaceChildren(h("option", { value: "", text: state.project ? "태그 선택" : "← 프로젝트 먼저" }));
  for (const t of tags) tagSel.append(h("option", { value: t.name, text: t.name }));
  tagSel.disabled = !state.project;
  const remembered = state.tag || state.lastTagByProject[state.project] || "";
  tagSel.value = tags.some((t) => t.name === remembered) ? remembered : "";
  state.tag = tagSel.value;

  const p = state.projects.find((x) => x.key === state.project);
  $("projectInfo").textContent = p
    ? `${p.running ? "유니티 실행 중 — 바로 임포트" : "유니티 꺼짐 — 켜면 자동 임포트"} · ${p.assetRoot}${p.installed === "" ? " · ⚠ 패키지 미설치" : ""}`
    : "";
  updateActions();
}

$("projectSel").addEventListener("change", (e) => {
  state.project = e.target.value;
  state.tag = "";
  renderTarget();
  remember();
});
$("tagSel").addEventListener("change", (e) => {
  state.tag = e.target.value;
  remember();
  updateActions();
});
function remember() {
  if (state.project) state.lastTagByProject[state.project] = state.tag;
  chrome.storage.local.set({ lastProject: state.project, lastTagByProject: state.lastTagByProject });
}

// ---- 받은 파일 ---------------------------------------------------------------
function assetStatus(a) {
  return a.booth?.status || (a.status === "pending" ? "downloaded" : a.status);
}
function filteredAssets() {
  const f = $("fileFilter").value;
  return state.assets.filter((a) => {
    const st = assetStatus(a);
    if (f === "todo") return !a.hidden && (st === "downloaded" || st === "failed");
    if (f === "queued") return st === "queued";
    if (f === "imported") return st === "imported";
    return true;
  });
}

function renderFiles() {
  const list = $("fileList");
  const assets = filteredAssets();
  if (!assets.length) {
    list.replaceChildren(h("div", { class: "empty", text: "표시할 파일이 없어요" }));
  } else {
    list.replaceChildren(
      ...assets.map((a) => {
        const b = a.booth || {};
        const chips = (b.queues || [])
          .filter((q) => q.status !== "cancelled")
          .map((q) => h("span", { class: `chip ${q.status}`, title: q.tag, text: `${q.projectName || "공용"} · ${STATUS_TEXT[q.status] || q.status}` }));
        if (!chips.length) chips.push(h("span", { class: "chip", text: a.file_type === "zip" || a.file_type === "unitypackage" ? "미처리" : a.file_type }));
        const row = h(
          "div",
          {
            class: `file${state.selected.has(a.filename) ? " selected" : ""}`,
            onclick: (e) => {
              if (e.target.tagName === "A") return;
              toggle(a.filename);
            },
          },
          h("input", { type: "checkbox", checked: state.selected.has(a.filename), "aria-label": a.filename, onclick: (e) => { e.stopPropagation(); toggle(a.filename); } }),
          b.thumbnail ? h("img", { src: b.thumbnail, alt: "", loading: "lazy" }) : h("div", { class: "noimg" }),
          h(
            "div",
            { class: "grow" },
            h("div", { class: "title" }, b.itemId ? h("a", { href: `https://booth.pm/ja/items/${b.itemId}`, target: "_blank", text: b.itemName || a.filename }) : a.filename),
            h("div", { class: "sub", text: b.itemId ? `${a.filename}${b.shopName ? ` · ${b.shopName}` : ""}` : "부스 정보 없음" }),
            h("div", { class: "chips" }, chips),
          ),
        );
        return row;
      }),
    );
  }
  $("selectAll").checked = assets.length > 0 && assets.every((a) => state.selected.has(a.filename));
  updateActions();
}

function toggle(filename) {
  if (state.selected.has(filename)) state.selected.delete(filename);
  else state.selected.add(filename);
  renderFiles();
}

function updateActions() {
  const n = state.selected.size;
  $("queueBtn").disabled = !n || !state.project || !state.tag;
  $("queueBtn").textContent = !state.project ? "1. 프로젝트를 고르세요" : !state.tag ? "2. 태그를 고르세요" : `3 ▶ ${n ? `${n}개 ` : ""}Unity로`;
  $("hideBtn").disabled = !n;
  $("deleteBtn").disabled = !n;
}

$("fileFilter").addEventListener("change", renderFiles);
$("selectAll").addEventListener("change", (e) => {
  for (const a of filteredAssets()) e.target.checked ? state.selected.add(a.filename) : state.selected.delete(a.filename);
  renderFiles();
});

$("queueBtn").addEventListener("click", async () => {
  const items = [...state.selected].map((filename) => ({ filename, tag: state.tag, project: state.project }));
  $("queueBtn").disabled = true;
  try {
    const res = await localApi("/api/assets/queue", { method: "POST", body: { items } });
    const failed = res.filter((r) => r.error);
    flash(failed.length ? `${failed.length}개 실패: ${failed[0].error}` : `${res.length}개 큐 등록`);
    state.selected.clear();
  } catch (error) {
    flash(error.message);
  }
  await load();
});
$("hideBtn").addEventListener("click", async () => {
  await localApi("/api/assets/hide", { method: "POST", body: { filenames: [...state.selected] } });
  state.selected.clear();
  load();
});
let deleteArmed = null;
$("deleteBtn").addEventListener("click", async () => {
  if (!deleteArmed) {
    $("deleteBtn").textContent = "정말 삭제?";
    deleteArmed = setTimeout(() => {
      deleteArmed = null;
      $("deleteBtn").textContent = "삭제";
    }, 3000);
    return;
  }
  clearTimeout(deleteArmed);
  deleteArmed = null;
  $("deleteBtn").textContent = "삭제";
  for (const f of state.selected) await localApi(`/api/assets/${encodeURIComponent(f)}`, { method: "DELETE" }).catch(() => {});
  state.selected.clear();
  load();
});

function flash(text) {
  $("projectInfo").textContent = text;
  setTimeout(renderTarget, 3500);
}

// ---- 대기열 -----------------------------------------------------------------
async function renderQueue() {
  const list = $("queueList");
  if (!state.online) return;
  const blocks = [];
  for (const p of state.projects) {
    const files = await localApi(`/api/projects/${encodeURIComponent(p.key)}/queue`).catch(() => []);
    if (!files.length) continue;
    blocks.push(
      h(
        "div",
        { class: "card qproject" },
        h("h3", {}, h("span", { class: `dot ${p.running ? "on" : ""}` }), p.name, h("span", { class: "muted", text: p.running ? "실행 중" : "꺼짐 — 유니티를 켜면 임포트" })),
        files.map((f) =>
          h(
            "div",
            { class: "qfile" },
            h("span", { class: `chip ${f.failed ? "failed" : "pending"}`, text: f.failed ? "실패" : "대기" }),
            h("span", { class: "grow ellipsis", title: f.path, text: `${f.tag} / ${f.name}` }),
            f.failed ? h("button", { class: "btn small", text: "재시도", onclick: async () => { await localApi("/api/queue/retry", { method: "POST", body: { path: f.path } }); load(); } }) : null,
            h("button", { class: "btn small", text: "취소", onclick: async () => { await localApi("/api/queue/cancel", { method: "POST", body: { path: f.path } }); load(); } }),
          ),
        ),
      ),
    );
  }
  list.replaceChildren(...(blocks.length ? blocks : [h("div", { class: "empty", text: "대기 중인 임포트가 없어요" })]));
}

// ---- 찜 정리 ----------------------------------------------------------------
function wishRules() {
  const rules = {};
  for (const row of document.querySelectorAll(".wish-rule")) {
    rules[row.dataset.cat] = { action: row.querySelector(".wish-action").value, name: row.querySelector(".wish-name").value.trim() };
  }
  return rules;
}
async function saveWishRules() {
  await chrome.storage.local.set({ wishRules: wishRules() });
}
async function loadWishRules() {
  const { wishRules: saved } = await chrome.storage.local.get("wishRules");
  if (!saved) return;
  for (const row of document.querySelectorAll(".wish-rule")) {
    const r = saved[row.dataset.cat];
    if (!r) continue;
    row.querySelector(".wish-action").value = r.action;
    row.querySelector(".wish-name").value = r.name;
  }
  syncWishInputs();
}
function syncWishInputs() {
  for (const row of document.querySelectorAll(".wish-rule")) {
    row.querySelector(".wish-name").classList.toggle("hidden", row.querySelector(".wish-action").value !== "list");
  }
}
document.querySelectorAll(".wish-rule select, .wish-rule input").forEach((n) =>
  n.addEventListener("change", () => {
    syncWishInputs();
    saveWishRules();
    if (state.wishScan) renderWishPlan();
  }),
);

function wishPlan() {
  const rules = wishRules();
  const items = (state.wishScan || [])
    .filter((i) => i.wished)
    .map((i) => ({ ...i, rule: rules[i.category] || { action: "keep" } }))
    .filter((i) => i.rule.action !== "keep");
  const managedNames = Object.values(rules).filter((r) => r.action === "list" && r.name).map((r) => r.name);
  return {
    view: items,
    plan: {
      items: items.map((i) => (i.rule.action === "remove" ? { id: i.id, action: "remove" } : { id: i.id, action: "list", listName: i.rule.name })),
      managedNames,
    },
  };
}

function renderWishPlan() {
  const { view } = wishPlan();
  const scan = state.wishScan || [];
  const wished = scan.filter((i) => i.wished);
  const count = (cat) => wished.filter((i) => i.category === cat).length;
  $("wishSummary").replaceChildren(
    h(
      "div",
      { class: "muted" },
      `구매 ${scan.length}개 중 찜에 있는 것 ${wished.length}개 — 풀팩 ${count("full")} · 일부 ${count("partial")} · 단일 ${count("single")}. `,
      h("strong", { text: `변경 예정 ${view.length}개` }),
    ),
  );
  $("wishList").replaceChildren(
    ...view.map((i) =>
      h(
        "div",
        { class: "wish-item" },
        i.thumbnail ? h("img", { src: i.thumbnail, alt: "", loading: "lazy" }) : h("span"),
        h("div", { class: "ellipsis", title: i.boughtNames.join(", ") }, h("a", { href: `https://booth.pm/ja/items/${i.id}`, target: "_blank", text: i.name || i.id })),
        h("span", { class: `chip ${i.rule.action === "remove" ? "err" : "ok"}`, text: i.rule.action === "remove" ? "찜 삭제" : `→ ${i.rule.name}` }),
      ),
    ),
  );
  $("wishApplyBtn").disabled = !view.length;
}

const wishLog = (text) => {
  const box = $("wishLog");
  box.classList.remove("hidden");
  box.textContent += `${text}\n`;
  box.scrollTop = box.scrollHeight;
};

$("wishScanBtn").addEventListener("click", async () => {
  $("wishScanBtn").disabled = true;
  $("wishApplyBtn").disabled = true;
  $("wishLog").textContent = "";
  try {
    state.wishScan = await send("wishlistScan");
    renderWishPlan();
    wishLog("미리보기 완료");
  } catch (error) {
    wishLog(`오류: ${error.message}`);
  } finally {
    $("wishScanBtn").disabled = false;
  }
});

let applyArmed = false;
$("wishApplyBtn").addEventListener("click", async () => {
  const { plan, view } = wishPlan();
  if (!applyArmed) {
    applyArmed = true;
    $("wishApplyBtn").textContent = `${view.length}개 변경 — 한 번 더 눌러 확정`;
    setTimeout(() => {
      applyArmed = false;
      $("wishApplyBtn").textContent = "실행";
    }, 5000);
    return;
  }
  applyArmed = false;
  $("wishApplyBtn").textContent = "실행";
  $("wishApplyBtn").disabled = true;
  wishLog(`${plan.items.length}개 적용 중…`);
  try {
    const res = await send("wishlistApply", { plan });
    if (res?.error) wishLog(`오류: ${res.error}`);
    const ok = (res?.results || []).filter((r) => r.ok).length;
    const bad = (res?.results || []).filter((r) => !r.ok);
    wishLog(`완료: ${ok}개 성공${bad.length ? `, ${bad.length}개 실패 (${bad.map((b) => `${b.id}:${b.status}`).join(", ")})` : ""}`);
    state.wishScan = null;
    $("wishList").replaceChildren();
    $("wishSummary").replaceChildren(h("div", { class: "muted", text: "다시 미리보기를 눌러 결과를 확인할 수 있어요." }));
  } catch (error) {
    wishLog(`오류: ${error.message}`);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "wishlist-progress") wishLog(msg.text);
  if (msg.type === "download-done" || msg.type === "download-error") load();
});

// ---- 탭 / 공통 --------------------------------------------------------------
document.querySelectorAll(".tabs button").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    for (const t of ["files", "queue", "wish"]) $(`tab-${t}`).classList.toggle("hidden", t !== btn.dataset.tab);
    if (btn.dataset.tab === "queue") renderQueue();
  }),
);
$("refreshBtn").addEventListener("click", load);
async function syncThemeBtn() {
  const { boothTheme } = await chrome.storage.local.get("boothTheme");
  const dark = boothTheme === "dark";
  $("themeBtn").textContent = dark ? "☀" : "☾";
  $("themeBtn").title = dark ? "부스 테마: 다크 (누르면 라이트)" : "부스 테마: 라이트 (누르면 다크)";
}
$("themeBtn").addEventListener("click", async () => {
  const { boothTheme } = await chrome.storage.local.get("boothTheme");
  await chrome.storage.local.set({ boothTheme: boothTheme === "dark" ? "light" : "dark" });
  syncThemeBtn();
});
syncThemeBtn();
$("retryBtn").addEventListener("click", load);
$("manageBtn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.configVersion) load();
});

loadWishRules();
load();
setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 10000);
