import { localApi, ping } from "../lib/local.js";

const VPM_INDEX = "https://raw.githubusercontent.com/Luin48/Booth-Import-Manager/main/vpm/index.json";

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = Boolean(v);
    else if (k === "indeterminate") node.indeterminate = Boolean(v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
};

const UNTAGGED = "태그 없음";
const state = { config: null, projects: [], suggestions: [] };

// ---- 공통 -------------------------------------------------------------------
let saveTimer = null;
function saved(text = "저장됨") {
  $("saveState").textContent = text;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => ($("saveState").textContent = ""), 2500);
  chrome.storage.local.set({ configVersion: Date.now() }); // 사이드패널 새로고침 신호
}
function fail(error) {
  $("saveState").textContent = `오류: ${error.message || error}`;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}${Math.random().toString(16).slice(2)}`);

function renderConn(unities) {
  const n = unities.length;
  $("connDot").className = `dot ${n ? "on" : "off"}`;
  $("connText").textContent = n ? `유니티 ${n}개 연결됨 (${unities.map((u) => u.name).join(", ")})` : "켜진 유니티 없음";
  $("offline").classList.toggle("hidden", n > 0);
  state.unities = unities;
}

async function load({ scan = false } = {}) {
  const alive = await ping();
  renderConn(alive.unities);
  if (scan && alive.unities.length) await localApi("/api/projects/scan", { method: "POST" }).catch(fail);
  const [config, projects] = await Promise.all([localApi("/api/config"), localApi("/api/projects?all=1")]);
  state.config = config;
  state.projects = projects;
  renderAll();
}

function renderAll() {
  renderRoots();
  renderProjects();
  renderTags();
  renderTagSets();
  renderMatrix();
  renderSettings();
}

async function saveConfig(patch) {
  try {
    await localApi("/api/config", { method: "POST", body: { ...state.config, ...patch } });
    Object.assign(state.config, patch);
    saved();
  } catch (error) {
    fail(error);
    throw error;
  }
}

async function saveProjects(updates) {
  try {
    await localApi("/api/projects/settings", { method: "POST", body: { updates } });
    for (const u of updates) {
      const p = state.projects.find((x) => x.key === u.key);
      if (!p) continue;
      if ("tags" in u) p.tags = u.tags;
      if ("hidden" in u) p.hidden = u.hidden;
      if ("alias" in u) p.name = u.alias || p.folderName;
      if ("assetRoot" in u) p.assetRoot = u.assetRoot;
    }
    saved();
  } catch (error) {
    fail(error);
  }
}

async function pickFolder(initial = "") {
  if (!state.unities?.length) {
    fail(new Error("폴더 선택 창은 유니티가 띄워요. 유니티를 하나 켜거나 경로를 직접 입력하세요"));
    return "";
  }
  $("saveState").textContent = "유니티 창 위에 뜬 폴더 선택 창을 확인하세요…";
  try {
    const res = await localApi("/api/pick-folder", { method: "POST", body: { initial }, timeoutMs: 600000 });
    $("saveState").textContent = "";
    return res.path || "";
  } catch (error) {
    fail(error);
    return "";
  }
}

// ---- 프로젝트 폴더 ------------------------------------------------------------
function renderRoots() {
  const roots = state.config.projectRoots || [];
  $("rootList").replaceChildren(
    ...(roots.length
      ? roots.map((root) => {
          const count = state.projects.filter((p) => p.path.toLowerCase().startsWith(root.toLowerCase())).length;
          return h(
            "div",
            { class: "root-row" },
            h("span", { class: "grow ellipsis", title: root, text: root }),
            h("span", { class: "chip", text: `프로젝트 ${count}개` }),
            h("button", { class: "btn small", text: "제거", onclick: () => saveConfig({ projectRoots: roots.filter((r) => r !== root) }).then(() => load({ scan: true })) }),
          );
        })
      : [h("div", { class: "muted", text: "아직 등록된 폴더가 없어요." })]),
  );
  const extras = state.config.extraProjects || [];
  $("extraList").replaceChildren(
    ...extras.map((p) =>
      h("div", { class: "extra-row" }, h("span", { class: "grow ellipsis", text: p }), h("button", { class: "btn small", text: "제거", onclick: () => saveConfig({ extraProjects: extras.filter((x) => x !== p) }).then(() => load({ scan: true })) })),
    ),
  );
  const fresh = state.suggestions.filter((s) => !roots.some((r) => r.toLowerCase() === s.path.toLowerCase()));
  $("suggestions").replaceChildren(
    ...(fresh.length ? [h("span", { class: "muted", text: "찾은 위치:" })] : []),
    ...fresh.map((s) =>
      h("button", { class: "btn", title: s.path, onclick: () => addRoot(s.path) }, h("strong", { text: `+ ${s.source}` }), h("div", { class: "muted", text: `${s.path} · 프로젝트 ${s.count}개` })),
    ),
  );
}

async function addRoot(path) {
  path = path.trim();
  if (!path) return;
  const roots = state.config.projectRoots || [];
  if (roots.some((r) => r.toLowerCase() === path.toLowerCase())) return;
  await saveConfig({ projectRoots: [...roots, path] });
  $("rootInput").value = "";
  if (!state.unities?.length) saved("등록됨 — 유니티를 하나 켜면 안의 프로젝트를 찾아요");
  load({ scan: true });
}
$("rootAddBtn").addEventListener("click", () => addRoot($("rootInput").value));
$("rootInput").addEventListener("keydown", (e) => e.key === "Enter" && addRoot($("rootInput").value));
$("rootPickBtn").addEventListener("click", async () => {
  const path = await pickFolder($("rootInput").value);
  if (path) addRoot(path);
});
$("extraPickBtn").addEventListener("click", async () => {
  const path = await pickFolder();
  if (path) $("extraInput").value = path;
});
$("extraAddBtn").addEventListener("click", async () => {
  try {
    await localApi("/api/projects/add", { method: "POST", body: { path: $("extraInput").value.trim() } });
    $("extraInput").value = "";
    saved("추가됨");
    load();
  } catch (error) {
    fail(error);
  }
});

// ---- 인식된 프로젝트 ------------------------------------------------------------
function newer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function packageCell(p) {
  const latest = p.latestVersion || "";
  if (p.installed === "packages") {
    const cur = p.installedVersion || "";
    const outdated = latest && cur && newer(latest, cur) && !p.running;
    return h("span", {
      class: `chip ${outdated ? "warn" : "ok"}`,
      title: outdated ? `새 버전 v${latest} — ALCOM에서 업데이트하세요` : "",
      text: cur ? `v${cur}${outdated ? " (업데이트 있음)" : ""}` : "설치됨",
    });
  }
  if (p.installed?.startsWith("assets:")) return h("span", { class: "chip warn", title: p.installed.slice(7), text: "Assets 안 (예전 방식)" });
  return h("span", { class: "chip", title: "ALCOM 저장소에서 추가하세요 (아래 '유니티 패키지')", text: "미설치" });
}

function renderProjects() {
  const showHidden = $("showHidden").checked;
  const rows = state.projects.filter((p) => showHidden || !p.hidden);
  $("projectRows").replaceChildren(
    ...(rows.length
      ? rows.map((p) =>
          h(
            "tr",
            { class: p.hidden ? "is-hidden" : "" },
            h(
              "td",
              { class: "pname" },
              h("input", {
                type: "text",
                value: p.name === p.folderName ? "" : p.name,
                placeholder: p.folderName,
                title: "표시 이름 (비우면 폴더 이름)",
                onchange: (e) => saveProjects([{ key: p.key, alias: e.target.value.trim() }]),
              }),
              h("div", { class: "ppath", text: `${p.path}${p.unityVersion ? ` · Unity ${p.unityVersion}` : ""}` }),
            ),
            h(
              "td",
              {},
              h("div", { class: "row wrap" },
                h("span", {
                  class: `chip ${p.running ? "ok" : p.openWithoutPackage ? "warn" : ""}`,
                  text: p.running ? "● 실행 중" : p.openWithoutPackage ? "● 열림 (패키지 없음)" : p.missing ? "○ 폴더 확인 필요" : "○ 꺼짐",
                }),
                p.pending ? h("span", { class: "chip pending", text: `대기 ${p.pending}` }) : null,
                p.failed ? h("span", { class: "chip failed", text: `실패 ${p.failed}` }) : null,
              ),
            ),
            h("td", {}, packageCell(p)),
            h(
              "td",
              {},
              h("input", {
                type: "text",
                class: "assetroot",
                value: p.assetRoot,
                placeholder: "Assets",
                onchange: (e) => saveProjects([{ key: p.key, assetRoot: e.target.value }]).then(load),
              }),
            ),
            h(
              "td",
              {},
              h("button", {
                class: "btn small",
                text: p.hidden ? "보이기" : "숨기기",
                onclick: () => saveProjects([{ key: p.key, hidden: !p.hidden }]).then(() => {
                  renderProjects();
                  renderMatrix();
                }),
              }),
            ),
          ),
        )
      : [h("tr", {}, h("td", { colspan: "5", class: "empty", text: "위에서 프로젝트 폴더를 등록하세요." }))]),
  );
}
$("showHidden").addEventListener("change", renderProjects);

// ---- 태그 라이브러리 ----------------------------------------------------------
function tagUsage(tagId) {
  const visible = state.projects.filter((p) => !p.hidden);
  return visible.filter((p) => !Array.isArray(p.tags) || p.tags.includes(tagId)).length;
}

async function saveTags(tags, projectUpdates = []) {
  await saveConfig({ tags });
  if (projectUpdates.length) await saveProjects(projectUpdates);
  // 서버가 삭제된 태그를 할당에서도 빼므로 다시 읽기
  state.projects = await localApi("/api/projects?all=1");
  state.config = await localApi("/api/config");
  renderTags();
  renderTagSets();
  renderMatrix();
}

const checkedTags = new Set();

function checkedTagIds() {
  // 라이브러리 순서 유지 + 지워진 태그 제외
  return (state.config.tags || []).map((t) => t.id).filter((id) => checkedTags.has(id));
}

function renderCheckBar() {
  const tags = state.config.tags || [];
  const n = checkedTagIds().length;
  $("tagCheckBar").replaceChildren(
    h("label", { class: "row" },
      h("input", {
        type: "checkbox",
        checked: n > 0 && n === tags.length,
        indeterminate: n > 0 && n < tags.length,
        onchange: (e) => {
          checkedTags.clear();
          if (e.target.checked) tags.forEach((t) => checkedTags.add(t.id));
          if (checkedTags.size) $("newSetSource").value = "checked";
          renderTags();
        },
      }),
      h("span", { text: n ? `${n}개 체크됨` : "전체 선택" }),
    ),
    h("span", { class: "muted", text: "체크한 태그로 아래 태그 세트를 만들거나 갱신할 수 있어요." }),
  );
  const src = $("newSetSource");
  if (src && src.firstElementChild?.value === "checked") src.firstElementChild.textContent = `체크한 태그 (${n}개)`;
}

function renderTags() {
  const tags = state.config.tags || [];
  for (const id of [...checkedTags]) if (!tags.some((t) => t.id === id)) checkedTags.delete(id);
  $("tagRows").replaceChildren(
    ...tags.map((tag, index) => {
      const special = tag.name === UNTAGGED;
      let armed = false;
      const row = h(
        "div",
        { class: "tag-row", "data-index": String(index) },
        h("span", {
          class: "drag-handle",
          title: "잡고 끌어서 순서 바꾸기 (키보드: ↑ ↓)",
          tabindex: "0",
          role: "button",
          "aria-label": `${tag.name} 순서 바꾸기`,
          text: "⠿",
          onmousedown: () => (row.draggable = true),
          ontouchstart: () => (row.draggable = true),
          onkeydown: (e) => {
            if (e.key === "ArrowUp" && index > 0) { e.preventDefault(); moveTo(index, index - 1, true); }
            if (e.key === "ArrowDown" && index < tags.length - 1) { e.preventDefault(); moveTo(index, index + 1, true); }
          },
        }),
        h("input", {
          type: "checkbox",
          class: "tag-check",
          checked: checkedTags.has(tag.id),
          title: "태그 세트에 넣을 태그로 체크",
          onchange: (e) => {
            if (e.target.checked) checkedTags.add(tag.id);
            else checkedTags.delete(tag.id);
            if (checkedTags.size) $("newSetSource").value = "checked";
            renderCheckBar();
          },
        }),
        h("input", {
          type: "text",
          value: tag.name,
          readonly: special,
          title: special ? "기본 태그라 이름을 바꿀 수 없어요" : "이름 (유니티 폴더 이름)",
          onchange: (e) => {
            const name = e.target.value.trim();
            if (!name || name === UNTAGGED || tags.some((t) => t.id !== tag.id && t.name === name)) {
              e.target.value = tag.name;
              fail(new Error("비어 있거나 이미 있는 이름이에요"));
              return;
            }
            saveTags(tags.map((t) => (t.id === tag.id ? { ...t, name } : t)));
          },
        }),
        h("span", { class: "usage", text: `${tagUsage(tag.id)}개 프로젝트` }),
        h(
          "div",
          { class: "tools" },
          h("button", {
            class: "btn small",
            title: "같은 프로젝트 할당까지 그대로 복제",
            text: "복제",
            disabled: special,
            onclick: () => duplicateTag(tag),
          }),
          h("button", {
            class: "btn small danger",
            text: "삭제",
            disabled: special,
            onclick: (e) => {
              if (!armed) {
                armed = true;
                e.target.textContent = "정말?";
                setTimeout(() => {
                  armed = false;
                  e.target.textContent = "삭제";
                }, 3000);
                return;
              }
              saveTags(tags.filter((t) => t.id !== tag.id));
            },
          }),
        ),
      );
      return row;
    }),
  );

  renderCheckBar();

  function moveTo(from, to, refocus = false) {
    if (from === to) return;
    const next = [...tags];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    saveTags(next).then(() => {
      if (refocus) $("tagRows").children[to]?.querySelector(".drag-handle")?.focus();
    });
  }

  // 끌어서 놓기: 핸들을 잡았을 때만 줄이 끌린다
  let dragFrom = -1;
  const rows = [...$("tagRows").children];
  const clear = () => rows.forEach((r) => r.classList.remove("drop-before", "drop-after", "dragging"));
  for (const r of rows) {
    r.addEventListener("dragstart", (e) => {
      dragFrom = Number(r.dataset.index);
      r.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", r.dataset.index);
    });
    r.addEventListener("dragend", () => {
      r.draggable = false;
      clear();
    });
    r.addEventListener("dragover", (e) => {
      if (dragFrom < 0) return;
      e.preventDefault();
      const rect = r.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      rows.forEach((x) => x !== r && x.classList.remove("drop-before", "drop-after"));
      r.classList.toggle("drop-after", after);
      r.classList.toggle("drop-before", !after);
    });
    r.addEventListener("drop", (e) => {
      e.preventDefault();
      const target = Number(r.dataset.index);
      const after = r.classList.contains("drop-after");
      clear();
      if (dragFrom < 0) return;
      let to = target + (after ? 1 : 0);
      if (dragFrom < to) to -= 1;
      const from = dragFrom;
      dragFrom = -1;
      moveTo(from, to);
    });
  }
}
// 핸들을 눌렀다 떼기만 하면 다시 끌 수 없는 상태로 (입력칸 글자 선택 방해 방지)
document.addEventListener("mouseup", () => document.querySelectorAll(".tag-row[draggable=true]").forEach((r) => (r.draggable = false)));

function uniqueName(base) {
  const names = new Set((state.config.tags || []).map((t) => t.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 100; i += 1) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  return `${base} ${Date.now()}`;
}

async function duplicateTag(tag) {
  const tags = state.config.tags || [];
  const copy = { id: uid(), name: uniqueName(`${tag.name} 복사`) };
  const index = tags.findIndex((t) => t.id === tag.id);
  const next = [...tags.slice(0, index + 1), copy, ...tags.slice(index + 1)];
  const updates = state.projects.filter((p) => Array.isArray(p.tags) && p.tags.includes(tag.id)).map((p) => ({ key: p.key, tags: [...p.tags, copy.id] }));
  await saveTags(next, updates);
}

$("addTagBtn").addEventListener("click", async () => {
  const name = $("newTagName").value.trim();
  if (!name) return;
  if ((state.config.tags || []).some((t) => t.name === name)) return fail(new Error("이미 있는 태그예요"));
  const tag = { id: uid(), name };
  const updates = $("newTagAssignAll").checked
    ? state.projects.filter((p) => Array.isArray(p.tags)).map((p) => ({ key: p.key, tags: [...p.tags, tag.id] }))
    : [];
  $("newTagName").value = "";
  await saveTags([...(state.config.tags || []), tag], updates);
});
$("newTagName").addEventListener("keydown", (e) => e.key === "Enter" && $("addTagBtn").click());

$("exportTagsBtn").addEventListener("click", async () => {
  const text = JSON.stringify((state.config.tags || []).map(({ name }) => name), null, 2);
  $("tagTransfer").value = text;
  try {
    await navigator.clipboard.writeText(text);
    saved("클립보드에 복사됨");
  } catch {
    saved("아래 칸에서 복사하세요");
  }
});
$("importTagsBtn").addEventListener("click", async () => {
  let raw = $("tagTransfer").value.trim();
  if (!raw) {
    try {
      raw = (await navigator.clipboard.readText()).trim();
    } catch {
      /* 권한 없음 */
    }
  }
  if (!raw) return fail(new Error("붙여넣을 내용이 없어요"));
  let incoming = [];
  try {
    const parsed = JSON.parse(raw);
    incoming = (Array.isArray(parsed) ? parsed : parsed.tags || []).map((t) => (typeof t === "string" ? { name: t } : t));
  } catch {
    incoming = raw.split(/\r?\n/).map((name) => ({ name: name.trim() }));
  }
  const existing = new Set((state.config.tags || []).map((t) => t.name));
  const added = incoming
    .filter((t) => t.name && !existing.has(t.name.trim()))
    .map((t) => ({ id: uid(), name: t.name.trim() }));
  if (!added.length) return saved("새로 추가할 태그가 없어요");
  await saveTags([...(state.config.tags || []), ...added]);
  saved(`${added.length}개 추가됨`);
});


// ---- 태그 세트 ------------------------------------------------------------------
const tagName = (id) => (state.config.tags || []).find((t) => t.id === id)?.name;

async function saveTagSets(sets) {
  await saveConfig({ tagSets: sets });
  renderTagSets();
  renderMatrix();
}

async function applySet(set, projectKeys) {
  const valid = new Set((state.config.tags || []).map((t) => t.id));
  const ids = set.tags.filter((id) => valid.has(id));
  await saveProjects(projectKeys.map((key) => ({ key, tags: ids })));
  saved(`"${set.name}" 적용됨 (${projectKeys.length}개 프로젝트)`);
  renderTags();
  renderMatrix();
}

function renderTagSets() {
  const sets = state.config.tagSets || [];
  const visible = state.projects.filter((p) => !p.hidden);
  $("tagSetRows").replaceChildren(
    ...(sets.length
      ? sets.map((set) => {
          let armed = false;
          const target = h("select", { "aria-label": "적용할 프로젝트" }, h("option", { value: "", text: "프로젝트 선택…" }), h("option", { value: "*", text: "모든 프로젝트" }), visible.map((p) => h("option", { value: p.key, text: p.name })));
          return h(
            "div",
            { class: "set-row" },
            h("input", {
              type: "text",
              value: set.name,
              title: "세트 이름",
              onchange: (e) => {
                const name = e.target.value.trim();
                if (!name) return (e.target.value = set.name);
                saveTagSets(sets.map((x) => (x.id === set.id ? { ...x, name } : x)));
              },
            }),
            h("div", { class: "set-tags" }, set.tags.map(tagName).filter(Boolean).map((n) => h("span", { class: "chip", text: n }))),
            h(
              "div",
              { class: "set-tools" },
              target,
              h("button", {
                class: "btn small primary",
                text: "적용",
                onclick: () => {
                  if (!target.value) return;
                  applySet(set, target.value === "*" ? visible.map((p) => p.key) : [target.value]);
                },
              }),
              h("button", {
                class: "btn small",
                title: "이 세트의 태그를 위 태그 라이브러리에 체크로 불러오기",
                text: "체크로 불러오기",
                onclick: () => {
                  checkedTags.clear();
                  set.tags.forEach((id) => checkedTags.add(id));
                  renderTags();
                  saved(`"${set.name}" 태그를 체크했어요`);
                },
              }),
              h("button", {
                class: "btn small",
                title: "태그 라이브러리에서 체크한 태그로 이 세트를 덮어쓰기",
                text: "체크한 태그로 갱신",
                onclick: () => {
                  const ids = checkedTagIds();
                  if (!ids.length) return fail(new Error("태그 라이브러리에서 태그를 먼저 체크하세요"));
                  saveTagSets(sets.map((x) => (x.id === set.id ? { ...x, tags: ids } : x)));
                  saved(`"${set.name}" 갱신됨 (태그 ${ids.length}개)`);
                },
              }),
              h("button", {
                class: "btn small danger",
                text: "삭제",
                onclick: (e) => {
                  if (!armed) {
                    armed = true;
                    e.target.textContent = "정말?";
                    setTimeout(() => {
                      armed = false;
                      e.target.textContent = "삭제";
                    }, 3000);
                    return;
                  }
                  saveTagSets(sets.filter((x) => x.id !== set.id));
                },
              }),
            ),
          );
        })
      : [h("div", { class: "muted", text: "저장된 세트가 없어요." })]),
  );
  const src = $("newSetSource");
  const prev = src.value;
  src.replaceChildren(
    h("option", { value: "checked", text: `체크한 태그 (${checkedTagIds().length}개)` }),
    h("option", { value: "*", text: "현재 태그 전부" }),
    visible.filter((p) => Array.isArray(p.tags)).map((p) => h("option", { value: p.key, text: `${p.name}의 태그` })),
  );
  if ([...src.options].some((o) => o.value === prev)) src.value = prev;
}

$("addSetBtn").addEventListener("click", async () => {
  const name = $("newSetName").value.trim();
  if (!name) return fail(new Error("세트 이름을 입력하세요"));
  const sets = state.config.tagSets || [];
  const source = $("newSetSource").value;
  const project = state.projects.find((p) => p.key === source);
  const tags =
    source === "checked"
      ? checkedTagIds()
      : project && Array.isArray(project.tags)
        ? [...project.tags]
        : (state.config.tags || []).map((t) => t.id);
  if (!tags.length) return fail(new Error("체크한 태그가 없어요"));
  const existingSet = sets.find((x) => x.name === name);
  $("newSetName").value = "";
  if (existingSet) {
    await saveTagSets(sets.map((x) => (x.id === existingSet.id ? { ...x, tags } : x)));
    return saved(`세트 "${name}" 갱신됨 (태그 ${tags.length}개)`);
  }
  await saveTagSets([...sets, { id: uid(), name, tags }]);
  saved(`세트 "${name}" 저장됨 (태그 ${tags.length}개)`);
});

// ---- 프로젝트별 태그 매트릭스 ----------------------------------------------------
function renderMatrix() {
  const tags = state.config.tags || [];
  const projects = state.projects.filter((p) => !p.hidden);
  const table = $("matrix");
  if (!projects.length) {
    table.replaceChildren(h("tr", {}, h("td", { class: "empty", text: "프로젝트를 먼저 등록하세요." })));
    return;
  }

  const setTags = (p, ids) => saveProjects([{ key: p.key, tags: ids }]).then(renderMatrix).then(renderTags);
  const explicit = (p) => (Array.isArray(p.tags) ? [...p.tags] : tags.map((t) => t.id));

  const head = h(
    "tr",
    {},
    h("th", { text: "태그" }),
    projects.map((p) =>
      h(
        "th",
        { class: "proj" },
        h("div", { class: "pn", text: p.name }),
        h(
          "div",
          { class: "ctrls" },
          h(
            "select",
            {
              title: "태그 사용 범위",
              onchange: (e) => setTags(p, e.target.value === "all" ? null : explicit(p)),
            },
            h("option", { value: "all", text: "제한 없음", selected: !Array.isArray(p.tags) }),
            h("option", { value: "pick", text: "직접 선택", selected: Array.isArray(p.tags) }),
          ),
          h(
            "div",
            { class: "row" },
            h("button", { class: "btn small", text: "전체", onclick: () => setTags(p, tags.map((t) => t.id)) }),
            h("button", { class: "btn small", text: "해제", onclick: () => setTags(p, []) }),
          ),
          (state.config.tagSets || []).length
            ? h(
                "select",
                {
                  title: "저장해 둔 태그 세트 적용",
                  onchange: (e) => {
                    const set = (state.config.tagSets || []).find((x) => x.id === e.target.value);
                    if (set) applySet(set, [p.key]);
                  },
                },
                h("option", { value: "", text: "세트 적용…" }),
                (state.config.tagSets || []).map((x) => h("option", { value: x.id, text: x.name })),
              )
            : null,
          h(
            "select",
            {
              title: "다른 프로젝트의 태그 구성을 그대로 복사",
              onchange: (e) => {
                const src = state.projects.find((x) => x.key === e.target.value);
                if (src) setTags(p, Array.isArray(src.tags) ? [...src.tags] : null);
              },
            },
            h("option", { value: "", text: "복사해오기…" }),
            projects.filter((x) => x.key !== p.key).map((x) => h("option", { value: x.key, text: x.name })),
          ),
        ),
      ),
    ),
    h("th", { text: "" }),
  );

  const rows = tags.map((tag) =>
    h(
      "tr",
      {},
      h("td", { class: "tagname" }, tag.name),
      projects.map((p) => {
        const unrestricted = !Array.isArray(p.tags);
        const on = unrestricted || p.tags.includes(tag.id) || tag.name === UNTAGGED;
        return h(
          "td",
          { class: `cell${unrestricted ? " unrestricted" : ""}` },
          h("input", {
            type: "checkbox",
            checked: on,
            disabled: tag.name === UNTAGGED,
            title: tag.name === UNTAGGED ? "항상 사용" : unrestricted ? "누르면 '직접 선택'으로 바뀌어요" : "",
            onchange: (e) => {
              const ids = explicit(p).filter((id) => id !== tag.id);
              if (e.target.checked) ids.push(tag.id);
              setTags(p, ids);
            },
          }),
        );
      }),
      h(
        "td",
        { class: "rowtools" },
        h("button", {
          class: "btn small",
          text: "모두 켜기",
          disabled: tag.name === UNTAGGED,
          onclick: () =>
            saveProjects(projects.filter((p) => Array.isArray(p.tags) && !p.tags.includes(tag.id)).map((p) => ({ key: p.key, tags: [...p.tags, tag.id] }))).then(renderMatrix),
        }),
        h("button", {
          class: "btn small",
          text: "모두 끄기",
          disabled: tag.name === UNTAGGED,
          onclick: () => saveProjects(projects.map((p) => ({ key: p.key, tags: explicit(p).filter((id) => id !== tag.id) }))).then(renderMatrix),
        }),
      ),
    ),
  );
  table.replaceChildren(h("thead", {}, head), h("tbody", {}, rows));
}

// ---- 설정 -------------------------------------------------------------------
async function renderSettings() {
  const c = state.config;
  $("downloadsDir").value = c.downloadsDir || "";
  $("downloadsDir").placeholder = "아직 몰라요 — [Unity로]로 처음 받으면 자동으로 채워져요";
  $("queueRoot").textContent = c.queueRoot ? `${c.queueRoot}\\대기열` : "다운로드 폴더\\BoothImportManager\\대기열";
  $("archiveDir").value = c.archiveDir || "";
  $("archiveDir").placeholder = c.queueRoot ? `${c.queueRoot}\\보관 (기본)` : "다운로드 폴더\\BoothImportManager\\보관 (기본)";
  $("keepArchive").checked = c.keepArchive !== false;
  const { boothTheme } = await chrome.storage.local.get("boothTheme");
  $("boothTheme").value = boothTheme === "dark" ? "dark" : "light";
  $("vpmUrl").value = VPM_INDEX;
}
$("boothTheme").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ boothTheme: e.target.value });
  saved(e.target.value === "dark" ? "부스 다크 테마 적용됨" : "부스 라이트 테마 적용됨");
});
$("archivePickBtn").addEventListener("click", async () => {
  const path = await pickFolder($("archiveDir").value);
  if (path) $("archiveDir").value = path;
});
$("archiveOpenBtn").addEventListener("click", () => {
  const c = state.config;
  const path = $("archiveDir").value.trim() || (c.queueRoot ? `${c.queueRoot}\\보관` : "");
  if (!path) return fail(new Error("아직 다운로드 폴더를 몰라요"));
  localApi("/api/reveal", { method: "POST", body: { path } }).catch(fail);
});
$("queueOpenBtn").addEventListener("click", () => {
  const c = state.config;
  if (!c.queueRoot) return fail(new Error("아직 다운로드 폴더를 몰라요"));
  localApi("/api/reveal", { method: "POST", body: { path: `${c.queueRoot}\\대기열` } }).catch(fail);
});
$("saveSettingsBtn").addEventListener("click", async () => {
  await saveConfig({ archiveDir: $("archiveDir").value.trim(), keepArchive: $("keepArchive").checked });
  saved(state.unities?.length ? "저장됨 (유니티에도 반영)" : "저장됨 — 유니티를 켜면 반영돼요");
});
$("vpmAddBtn").addEventListener("click", () => {
  window.open(`vcc://vpm/addRepo?url=${encodeURIComponent(VPM_INDEX)}`, "_self");
});
$("vpmCopyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(VPM_INDEX).catch(() => {});
  saved("저장소 주소 복사됨");
});
$("reloadExtBtn").addEventListener("click", () => chrome.runtime.reload());

// ---- 에셋 프리셋 --------------------------------------------------------------
const presetState = { presets: [], changes: {}, armed: null };
const itemPageUrl = (id) => `https://booth.pm/${/^ja/.test(navigator.language) ? "ja" : /^ko/.test(navigator.language) ? "ko" : "en"}/items/${id}`;

async function loadPresets() {
  try {
    const res = await localApi("/api/presets");
    presetState.presets = res.presets || [];
    presetState.changes = res.changes || {};
    renderPresets();
  } catch (error) {
    fail(error);
  }
}

async function savePresets(msg = "저장됨") {
  try {
    presetState.presets = await localApi("/api/presets/save", { method: "POST", body: { presets: presetState.presets } });
    saved(msg);
    await loadPresets();
  } catch (error) {
    fail(error);
  }
}

function changeText(c) {
  const bits = [];
  if (c.added.length) bits.push(`새 파일: ${c.added.map((f) => f.label || f.id).join(", ")}`);
  if (c.removed.length) bits.push(`사라진 파일: ${c.removed.map((f) => f.label || f.id).join(", ")}`);
  return bits.join(" · ");
}

function renderPresets() {
  const tags = (state.config?.tags || []).map((t) => t.name);
  const projects = state.projects.filter((p) => !p.hidden);
  const list = presetState.presets;
  if (!list.length) {
    $("presetList").replaceChildren(h("div", { class: "card block muted", text: "아직 프리셋이 없어요. 위에서 만들거나, BOOTH 라이브러리의 BIM 줄에서 만들 수 있어요." }));
    return;
  }
  $("presetList").replaceChildren(
    ...list.map((preset) => {
      const changed = preset.items.filter((e) => presetState.changes[`${preset.id}:${e.downloadableId}`]);
      const target = h("select", { "aria-label": "보낼 프로젝트" }, h("option", { value: "", text: "프로젝트 선택…" }), projects.map((p) => h("option", { value: p.key, text: `${p.running ? "● " : ""}${p.name}` })));
      const sendBtn = h("button", {
        class: "btn primary",
        text: `한번에 보내기 (${preset.items.length})`,
        disabled: !preset.items.length,
        onclick: async () => {
          if (!target.value) return fail(new Error("보낼 프로젝트를 고르세요"));
          sendBtn.disabled = true;
          sendBtn.textContent = "보내는 중…";
          try {
            const res = await localApi("/api/presets/send", { method: "POST", body: { presetId: preset.id, project: target.value } });
            const name = projects.find((p) => p.key === target.value)?.name || "";
            saved(res.failed.length ? `${res.sent}개 보냄, ${res.failed.length}개 실패 (${res.failed[0].error})` : `${name}(으)로 ${res.sent}개 보냄 — 사이드패널 대기열에서 확인할 수 있어요`);
          } catch (error) {
            fail(error);
          } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = `한번에 보내기 (${preset.items.length})`;
          }
        },
      });
      const del = h("button", {
        class: "btn small danger",
        text: presetState.armed === preset.id ? "정말 삭제?" : "삭제",
        onclick: () => {
          if (presetState.armed !== preset.id) {
            presetState.armed = preset.id;
            renderPresets();
            setTimeout(() => {
              if (presetState.armed === preset.id) {
                presetState.armed = null;
                renderPresets();
              }
            }, 3000);
            return;
          }
          presetState.armed = null;
          presetState.presets = presetState.presets.filter((x) => x.id !== preset.id);
          savePresets("프리셋 삭제됨");
        },
      });
      const rows = preset.items.map((e) => {
        const c = presetState.changes[`${preset.id}:${e.downloadableId}`];
        const tagSel = h("select", { class: "preset-tag", "aria-label": "저장 태그", onchange: (ev) => { e.tag = ev.target.value; savePresets(); } },
          [...new Set([...tags, e.tag])].map((t) => h("option", { value: t, text: t })));
        tagSel.value = e.tag;
        return h(
          "div",
          { class: `preset-item${c ? " changed" : ""}` },
          e.thumbnail ? h("img", { src: e.thumbnail, alt: "", loading: "lazy" }) : h("div", { class: "noimg" }),
          h(
            "div",
            { class: "grow preset-info" },
            h("div", { class: "preset-title", text: e.itemName || e.fileLabel }),
            h("div", { class: "muted small-text", text: `${e.fileLabel}${e.shopName ? ` · ${e.shopName}` : ""}` }),
            c
              ? h(
                  "div",
                  { class: "preset-change" },
                  h("span", { class: "chip warn", text: c.missing ? "⚠ 담은 파일이 없어졌어요" : "⚠ 다운로드 항목 바뀜" }),
                  h("span", { class: "small-text", text: changeText(c) }),
                  h("button", {
                    class: "btn small",
                    title: "바뀐 목록을 확인했어요 (표시 지우기)",
                    text: "확인함",
                    onclick: async () => {
                      await localApi("/api/presets/ack", { method: "POST", body: { presetId: preset.id, itemId: e.itemId } }).catch(fail);
                      loadPresets();
                    },
                  }),
                )
              : null,
          ),
          tagSel,
          e.itemId ? h("a", { class: "btn small", href: itemPageUrl(e.itemId), target: "_blank", rel: "noopener", title: "BOOTH 상품 페이지 열기", text: "상품 페이지 ↗" }) : null,
          h("button", {
            class: "btn small",
            title: "프리셋에서 빼기",
            text: "✕",
            onclick: () => {
              preset.items = preset.items.filter((x) => x !== e);
              savePresets("빠짐");
            },
          }),
        );
      });
      return h(
        "div",
        { class: "card block preset-card" },
        h(
          "div",
          { class: "row wrap preset-head" },
          h("input", {
            type: "text",
            class: "preset-name",
            value: preset.name,
            "aria-label": "프리셋 이름",
            onchange: (ev) => {
              const name = ev.target.value.trim();
              if (!name) return (ev.target.value = preset.name);
              preset.name = name;
              savePresets("이름 바뀜");
            },
          }),
          h("span", { class: "chip", text: `${preset.items.length}개` }),
          changed.length ? h("span", { class: "chip warn", text: `업데이트 ${changed.length}` }) : null,
          h("span", { class: "grow" }),
          target,
          sendBtn,
          del,
        ),
        rows.length ? h("div", { class: "stack" }, rows) : h("div", { class: "muted", text: "비어 있어요. BOOTH 라이브러리에서 ＋ 프리셋으로 담으세요." }),
      );
    }),
  );
}

$("addPresetBtn").addEventListener("click", async () => {
  try {
    await localApi("/api/presets/create", { method: "POST", body: { name: $("newPresetName").value } });
    $("newPresetName").value = "";
    saved("프리셋 만들었어요");
    loadPresets();
  } catch (error) {
    fail(error);
  }
});
$("newPresetName").addEventListener("keydown", (e) => e.key === "Enter" && $("addPresetBtn").click());
$("presetCheckBtn").addEventListener("click", async () => {
  $("presetCheckBtn").disabled = true;
  $("presetCheckInfo").textContent = "BOOTH 라이브러리를 읽는 중… (상품 수에 따라 조금 걸려요)";
  try {
    const res = await chrome.runtime.sendMessage({ type: "presetCheck" });
    if (!res?.ok) throw new Error(res?.error || "확인 실패");
    $("presetCheckInfo").textContent = `라이브러리 상품 ${res.data.items}개 확인함 (${new Date().toLocaleTimeString()})`;
    loadPresets();
  } catch (error) {
    $("presetCheckInfo").textContent = "";
    fail(error);
  } finally {
    $("presetCheckBtn").disabled = false;
  }
});
async function showLibraryExport() {
  const { libraryExport } = await chrome.storage.local.get("libraryExport");
  $("libraryExportInfo").textContent = libraryExport ? `마지막 저장: ${new Date(libraryExport.at).toLocaleString()} · 상품 ${libraryExport.count}개` : "아직 저장한 적 없음";
}
$("libraryExportBtn").addEventListener("click", async () => {
  $("libraryExportBtn").disabled = true;
  $("libraryExportInfo").textContent = "BOOTH 라이브러리를 읽는 중… (상품 수에 따라 조금 걸려요)";
  try {
    const res = await chrome.runtime.sendMessage({ type: "libraryExport" });
    if (!res?.ok) throw new Error(res?.error || "저장 실패");
    await showLibraryExport();
  } catch (error) {
    $("libraryExportInfo").textContent = "";
    fail(error);
  } finally {
    $("libraryExportBtn").disabled = false;
  }
});
showLibraryExport();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.presetsVersion && !$("tab-presets").classList.contains("hidden")) loadPresets();
});

// ---- 탭 ---------------------------------------------------------------------
function showTab(name) {
  document.querySelectorAll(".m-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  for (const t of ["projects", "tags", "assign", "presets", "settings"]) $(`tab-${t}`).classList.toggle("hidden", t !== name);
  if (name === "presets") loadPresets();
  history.replaceState(null, "", `#${name}`);
}
document.querySelectorAll(".m-tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$("retryBtn").addEventListener("click", () => load({ scan: true }));

showTab((location.hash || "#projects").slice(1).replace(/[^a-z]/g, "") || "projects");
load({ scan: true })
  .then(async () => {
    if (!state.config) return;
    state.suggestions = await localApi("/api/projects/suggest").catch(() => []);
    renderRoots();
  })
  .catch(fail);
setInterval(async () => {
  // 실행 중/대기 상태만 가볍게 갱신 (입력 중이면 건너뜀)
  if (document.visibilityState !== "visible" || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  try {
    const alive = await ping();
    const before = (state.unities || []).map((u) => u.key).join();
    renderConn(alive.unities);
    state.projects = await localApi("/api/projects?all=1");
    renderProjects();
    if (before !== alive.unities.map((u) => u.key).join()) renderSettings();
  } catch {
    /* 꺼짐 */
  }
}, 8000);
