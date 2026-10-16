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

const STATUS_TEXT = { downloading: "받는 중", queued: "대기", importing: "임포트 중", imported: "임포트됨", failed: "실패", no_package: "패키지 없음", cancelled: "취소" };
const UNTAGGED = "태그 없음";
const ACTIVE = new Set(["downloading", "queued", "importing"]);

const state = {
  unities: [],
  config: null,
  projects: [],
  jobs: [],
  selected: new Set(),
  project: "",
  tag: "",
  lastTagByProject: {},
  wishScan: null,
};

// ---- 로드 -------------------------------------------------------------------
async function load() {
  const alive = await ping();
  state.unities = alive.unities;
  const n = alive.unities.length;
  $("conn").querySelector(".dot").className = `dot ${n ? "on" : "off"}`;
  $("connText").textContent = n ? `유니티 ${n}개` : "유니티 꺼짐";
  $("conn").title = n ? alive.unities.map((u) => u.name).join(", ") : "켜진 유니티가 없어도 [Unity로]는 대기열에 쌓였다가 유니티를 켜면 임포트돼요";
  const [config, projects, jobs, prefs] = await Promise.all([
    localApi("/api/config"),
    localApi("/api/projects?all=0"),
    localApi("/api/jobs"),
    chrome.storage.local.get(["lastProject", "lastTagByProject"]),
  ]);
  state.config = config;
  state.projects = projects;
  state.jobs = jobs;
  state.lastTagByProject = prefs.lastTagByProject || {};
  if (!state.project || !projects.some((p) => p.key === state.project)) state.project = prefs.lastProject || "";
  state.selected = new Set([...state.selected].filter((id) => jobs.some((j) => j.jobId === id)));
  $("offline").classList.toggle("hidden", projects.length > 0);
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
  sel.replaceChildren(h("option", { value: "", text: state.projects.length ? "유니티 프로젝트 선택" : "프로젝트 없음 — 유니티를 켜거나 관리에서 폴더 등록" }));
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
    ? `${p.running ? "유니티 실행 중 — 바로 임포트" : "유니티 꺼짐 — 켜면 자동 임포트"} · ${p.assetRoot}${p.installed === "" ? " · ⚠ BIM 패키지 미설치" : ""}`
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

// ---- 받은 파일 (작업 기록) -------------------------------------------------------
function filteredJobs() {
  const f = $("fileFilter").value;
  return state.jobs.filter((j) => {
    if (f === "todo") return !j.hidden && (j.state === "failed" || j.state === "no_package");
    if (f === "queued") return ACTIVE.has(j.state);
    if (f === "imported") return j.state === "imported";
    return !j.hidden || f === "all";
  });
}

function renderFiles() {
  const list = $("fileList");
  const jobs = filteredJobs();
  if (!jobs.length) {
    list.replaceChildren(h("div", { class: "empty", text: "표시할 기록이 없어요" }));
  } else {
    list.replaceChildren(
      ...jobs.map((j) =>
        h(
          "div",
          {
            class: `file${state.selected.has(j.jobId) ? " selected" : ""}`,
            onclick: (e) => {
              if (e.target.tagName === "A") return;
              toggle(j.jobId);
            },
          },
          h("input", { type: "checkbox", checked: state.selected.has(j.jobId), "aria-label": j.filename || j.itemName, onclick: (e) => { e.stopPropagation(); toggle(j.jobId); } }),
          j.thumbnail ? h("img", { src: j.thumbnail, alt: "", loading: "lazy" }) : h("div", { class: "noimg" }),
          h(
            "div",
            { class: "grow" },
            h("div", { class: "title" }, j.itemId ? h("a", { href: `https://booth.pm/ja/items/${j.itemId}`, target: "_blank", text: j.itemName || j.filename }) : j.filename || j.fileLabel),
            h("div", { class: "sub", text: `${j.filename || j.fileLabel || ""}${j.shopName ? ` · ${j.shopName}` : ""}` }),
            h(
              "div",
              { class: "chips" },
              h("span", { class: `chip ${j.state}`, title: j.error || j.tag, text: `${j.projectName || ""} / ${j.tag} · ${STATUS_TEXT[j.state] || j.state}` }),
              j.error && j.state !== "imported" ? h("span", { class: "muted small-text", text: j.error }) : null,
            ),
          ),
        ),
      ),
    );
  }
  $("selectAll").checked = jobs.length > 0 && jobs.every((j) => state.selected.has(j.jobId));
  updateActions();
}

function toggle(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderFiles();
}

function updateActions() {
  const n = state.selected.size;
  $("queueBtn").disabled = !n || !state.project || !state.tag;
  $("queueBtn").textContent = !state.project ? "1. 프로젝트를 고르세요" : !state.tag ? "2. 태그를 고르세요" : `3 ▶ ${n ? `${n}개 ` : ""}다시 보내기`;
  $("hideBtn").disabled = !n;
  $("deleteBtn").disabled = !n;
}

$("fileFilter").addEventListener("change", renderFiles);
$("selectAll").addEventListener("change", (e) => {
  for (const j of filteredJobs()) e.target.checked ? state.selected.add(j.jobId) : state.selected.delete(j.jobId);
  renderFiles();
});

$("queueBtn").addEventListener("click", async () => {
  $("queueBtn").disabled = true;
  try {
    const res = await localApi("/api/jobs/resend", { method: "POST", body: { jobIds: [...state.selected], project: state.project, tag: state.tag } });
    const failed = res.filter((r) => r.error);
    flash(failed.length ? `${failed.length}개 실패: ${failed[0].error}` : `${res.length}개 보냄`);
    state.selected.clear();
  } catch (error) {
    flash(error.message);
  }
  await load();
});
$("hideBtn").addEventListener("click", async () => {
  await localApi("/api/jobs/hide", { method: "POST", body: { jobIds: [...state.selected] } });
  state.selected.clear();
  load();
});
let deleteArmed = null;
$("deleteBtn").addEventListener("click", async () => {
  if (!deleteArmed) {
    $("deleteBtn").textContent = "정말 지울까요?";
    deleteArmed = setTimeout(() => {
      deleteArmed = null;
      $("deleteBtn").textContent = "기록 삭제";
    }, 3000);
    return;
  }
  clearTimeout(deleteArmed);
  deleteArmed = null;
  $("deleteBtn").textContent = "기록 삭제";
  await localApi("/api/jobs/remove", { method: "POST", body: { jobIds: [...state.selected] } });
  state.selected.clear();
  load();
});

function flash(text) {
  $("projectInfo").textContent = text;
  setTimeout(renderTarget, 3500);
}

// ---- 대기열 -----------------------------------------------------------------
function renderQueue() {
  const list = $("queueList");
  const active = state.jobs.filter((j) => ACTIVE.has(j.state));
  const groups = new Map();
  for (const j of active) {
    if (!groups.has(j.project)) groups.set(j.project, []);
    groups.get(j.project).push(j);
  }
  const blocks = [...groups].map(([key, jobs]) => {
    const p = state.projects.find((x) => x.key === key);
    const running = Boolean(p?.running);
    return h(
      "div",
      { class: "card qproject" },
      h("h3", {}, h("span", { class: `dot ${running ? "on" : ""}` }), p?.name || jobs[0].projectName || key, h("span", { class: "muted", text: running ? "실행 중" : "꺼짐 — 유니티를 켜면 임포트" })),
      jobs.map((j) =>
        h(
          "div",
          { class: "qfile" },
          h("span", { class: `chip ${j.state === "importing" ? "queued" : "pending"}`, text: STATUS_TEXT[j.state] }),
          h("span", { class: "grow ellipsis", title: j.filename, text: `${j.tag} / ${j.filename || j.fileLabel || "받는 중…"}` }),
          j.state !== "importing"
            ? h("button", {
                class: "btn small",
                text: "취소",
                onclick: async () => {
                  try {
                    await localApi("/api/jobs/cancel", { method: "POST", body: { jobId: j.jobId } });
                  } catch (error) {
                    flash(error.message);
                  }
                  load();
                },
              })
            : null,
        ),
      ),
    );
  });
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
  if (msg.type === "download-done" || msg.type === "download-error" || msg.type === "download-failed") load();
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
$("retryBtn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("manage.html#projects") }));
$("manageBtn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.configVersion) load();
});

loadWishRules();
load();
setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 5000);
