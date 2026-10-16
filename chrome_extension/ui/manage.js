import { DEFAULT_PORT, getPort, localApi, ping } from "../lib/local.js";

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = Boolean(v);
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

async function load() {
  const alive = await ping();
  $("connDot").className = `dot ${alive.ok ? "on" : "off"}`;
  $("connText").textContent = alive.ok ? `로컬 앱 연결됨 (v${alive.version})` : "로컬 앱 꺼짐";
  $("offline").classList.toggle("hidden", alive.ok);
  if (!alive.ok) return;
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
  $("saveState").textContent = "PC에 뜬 폴더 선택 창을 확인하세요…";
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
            h("button", { class: "btn small", text: "제거", onclick: () => saveConfig({ projectRoots: roots.filter((r) => r !== root) }).then(load) }),
          );
        })
      : [h("div", { class: "muted", text: "아직 등록된 폴더가 없어요." })]),
  );
  const extras = state.config.extraProjects || [];
  $("extraList").replaceChildren(
    ...extras.map((p) =>
      h("div", { class: "extra-row" }, h("span", { class: "grow ellipsis", text: p }), h("button", { class: "btn small", text: "제거", onclick: () => saveConfig({ extraProjects: extras.filter((x) => x !== p) }).then(load) })),
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
  load();
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
function packageCell(p) {
  const install = async (btn) => {
    btn.disabled = true;
    btn.textContent = "설치 중…";
    try {
      const res = await localApi("/api/projects/install", { method: "POST", body: { key: p.key } });
      saved(res.mode === "packages" ? `${p.name}: 설치됨 (유니티가 켜져 있으면 자동 컴파일)` : `${p.name}: 기존 위치 업데이트됨`);
      load();
    } catch (error) {
      fail(error);
      btn.disabled = false;
    }
  };
  if (p.installed === "packages") {
    return h("div", { class: "row wrap" }, h("span", { class: "chip ok", text: p.packageVersion ? `설치됨 v${p.packageVersion}` : "설치됨" }), h("button", { class: "btn small", text: "재설치", onclick: (e) => install(e.target) }));
  }
  if (p.installed?.startsWith("assets:")) {
    return h(
      "div",
      { class: "row wrap" },
      h("span", { class: "chip warn", title: p.installed.slice(7), text: "Assets 안 (이전 방식)" }),
      h("button", { class: "btn small", text: "v0.3로 업데이트", onclick: (e) => install(e.target) }),
    );
  }
  return h("button", { class: "btn small primary", text: "설치", onclick: (e) => install(e.target) });
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
                h("span", { class: `chip ${p.running ? "ok" : ""}`, text: p.running ? "● 실행 중" : "○ 꺼짐" }),
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

function renderTags() {
  const tags = state.config.tags || [];
  $("tagRows").replaceChildren(
    ...tags.map((tag, index) => {
      const special = tag.name === UNTAGGED;
      let armed = false;
      return h(
        "div",
        { class: "tag-row" },
        h("input", {
          type: "color",
          value: tag.color || "#2563eb",
          title: "색상",
          onchange: (e) => saveTags(tags.map((t) => (t.id === tag.id ? { ...t, color: e.target.value } : t))),
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
          h("button", { class: "btn small", title: "위로", text: "↑", disabled: index === 0, onclick: () => move(index, -1) }),
          h("button", { class: "btn small", title: "아래로", text: "↓", disabled: index === tags.length - 1, onclick: () => move(index, 1) }),
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
    }),
  );

  function move(index, delta) {
    const next = [...tags];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    saveTags(next);
  }
}

function uniqueName(base) {
  const names = new Set((state.config.tags || []).map((t) => t.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 100; i += 1) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  return `${base} ${Date.now()}`;
}

async function duplicateTag(tag) {
  const tags = state.config.tags || [];
  const copy = { id: uid(), name: uniqueName(`${tag.name} 복사`), color: tag.color };
  const index = tags.findIndex((t) => t.id === tag.id);
  const next = [...tags.slice(0, index + 1), copy, ...tags.slice(index + 1)];
  const updates = state.projects.filter((p) => Array.isArray(p.tags) && p.tags.includes(tag.id)).map((p) => ({ key: p.key, tags: [...p.tags, copy.id] }));
  await saveTags(next, updates);
}

$("addTagBtn").addEventListener("click", async () => {
  const name = $("newTagName").value.trim();
  if (!name) return;
  if ((state.config.tags || []).some((t) => t.name === name)) return fail(new Error("이미 있는 태그예요"));
  const tag = { id: uid(), name, color: $("newTagColor").value };
  const updates = $("newTagAssignAll").checked
    ? state.projects.filter((p) => Array.isArray(p.tags)).map((p) => ({ key: p.key, tags: [...p.tags, tag.id] }))
    : [];
  $("newTagName").value = "";
  await saveTags([...(state.config.tags || []), tag], updates);
});
$("newTagName").addEventListener("keydown", (e) => e.key === "Enter" && $("addTagBtn").click());

$("exportTagsBtn").addEventListener("click", async () => {
  const text = JSON.stringify((state.config.tags || []).map(({ name, color }) => ({ name, color })), null, 2);
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
    .map((t) => ({ id: uid(), name: t.name.trim(), color: /^#[0-9a-f]{6}$/i.test(t.color || "") ? t.color : "#64748b" }));
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
                title: "현재 태그 전부로 이 세트를 덮어쓰기",
                text: "현재 태그로 갱신",
                onclick: () => saveTagSets(sets.map((x) => (x.id === set.id ? { ...x, tags: (state.config.tags || []).map((t) => t.id) } : x))),
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
  src.replaceChildren(
    h("option", { value: "*", text: "현재 태그 전부" }),
    visible.filter((p) => Array.isArray(p.tags)).map((p) => h("option", { value: p.key, text: `${p.name}의 태그` })),
  );
}

$("addSetBtn").addEventListener("click", async () => {
  const name = $("newSetName").value.trim();
  if (!name) return fail(new Error("세트 이름을 입력하세요"));
  const sets = state.config.tagSets || [];
  if (sets.some((x) => x.name === name)) return fail(new Error("같은 이름의 세트가 있어요"));
  const source = $("newSetSource").value;
  const project = state.projects.find((p) => p.key === source);
  const tags = project && Array.isArray(project.tags) ? [...project.tags] : (state.config.tags || []).map((t) => t.id);
  $("newSetName").value = "";
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
      h("td", { class: "tagname" }, h("span", { class: "row" }, h("span", { class: "tag-swatch", style: `background:${tag.color}` }), tag.name)),
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
  $("downloadFolder").value = c.downloadFolder || "";
  $("intakeFolder").value = c.intakeFolder || "";
  $("queueFolder").value = c.queueFolder || "";
  $("autoQueue").checked = c.autoQueue !== false;
  $("deleteLocal").checked = Boolean(c.deleteLocalAfterQueue);
  $("stayRunning").checked = c.stayRunning !== false;
  $("port").value = await getPort();
  const { boothTheme } = await chrome.storage.local.get("boothTheme");
  $("boothTheme").value = boothTheme === "dark" ? "dark" : "light";
}
$("boothTheme").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ boothTheme: e.target.value });
  saved(e.target.value === "dark" ? "부스 다크 테마 적용됨" : "부스 라이트 테마 적용됨");
});
document.querySelectorAll(".pick").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const input = $(btn.dataset.target);
    const path = await pickFolder(input.value);
    if (path) input.value = path;
  }),
);
$("saveSettingsBtn").addEventListener("click", async () => {
  const port = Number($("port").value) || DEFAULT_PORT;
  const portChanged = port !== (await getPort());
  await saveConfig({
    downloadFolder: $("downloadFolder").value.trim(),
    intakeFolder: $("intakeFolder").value.trim(),
    queueFolder: $("queueFolder").value.trim(),
    autoQueue: $("autoQueue").checked,
    deleteLocalAfterQueue: $("deleteLocal").checked,
    stayRunning: $("stayRunning").checked,
    port,
  });
  if (portChanged) {
    await chrome.storage.local.set({ localPort: port });
    saved("포트 변경됨 — 로컬 앱을 다시 실행하세요");
  }
});
$("reloadExtBtn").addEventListener("click", () => chrome.runtime.reload());
$("quitBtn").addEventListener("click", async () => {
  await localApi("/api/shutdown", { method: "POST", body: { reason: "user" } }).catch(() => {});
  setTimeout(load, 800);
});

// ---- 탭 ---------------------------------------------------------------------
function showTab(name) {
  document.querySelectorAll(".m-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  for (const t of ["projects", "tags", "assign", "settings"]) $(`tab-${t}`).classList.toggle("hidden", t !== name);
  history.replaceState(null, "", `#${name}`);
}
document.querySelectorAll(".m-tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$("retryBtn").addEventListener("click", load);

showTab((location.hash || "#projects").slice(1).replace(/[^a-z]/g, "") || "projects");
load()
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
    state.projects = await localApi("/api/projects?all=1");
    renderProjects();
  } catch {
    /* 꺼짐 */
  }
}, 8000);
