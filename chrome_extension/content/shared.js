// 콘텐츠 스크립트 공통 (library.js / item.js 보다 먼저 로드)
(() => {
  if (window.BIM) return;

  const send = (type, payload = {}) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!res || !res.ok) return reject(new Error(res?.error || "응답 없음"));
        resolve(res.data);
      });
    });

  const el = (tag, attrs = {}, ...children) => {
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

  const state = { boot: null, bootPromise: null, listeners: new Set() };

  async function bootstrap(force = false) {
    if (state.boot && !force) return state.boot;
    if (!state.bootPromise || force) {
      state.bootPromise = send("bootstrap")
        .then((boot) => {
          state.boot = boot;
          return boot;
        })
        .catch((error) => {
          state.bootPromise = null;
          throw error;
        });
    }
    return state.bootPromise;
  }

  const UNTAGGED = "태그 없음";

  function tagsFor(projectKey) {
    const boot = state.boot;
    if (!boot) return [];
    const all = boot.config.tags || [];
    const project = boot.projects.find((p) => p.key === projectKey);
    if (!project || !Array.isArray(project.tags)) return all;
    const allowed = new Set(project.tags);
    return all.filter((t) => allowed.has(t.id) || t.name === UNTAGGED);
  }

  function projectLabel(p) {
    const bits = [p.name];
    if (p.running) bits.push("● 실행 중");
    else bits.push("○ 꺼짐");
    if (p.pending) bits.push(`대기 ${p.pending}`);
    return bits.join("  ");
  }

  const STATUS_TEXT = {
    pending: "대기",
    queued: "대기",
    imported: "임포트됨",
    failed: "실패",
    no_package: "패키지 없음",
    downloaded: "받음",
  };

  function statusChips(entry) {
    const wrap = el("span", { class: "bim-chips" });
    if (!entry) return wrap;
    const projects = entry.projects || [];
    if (!projects.length && entry.status) {
      wrap.append(el("span", { class: `bim-chip bim-st-${entry.status}`, text: STATUS_TEXT[entry.status] || entry.status }));
    }
    for (const p of projects) {
      const label = `${p.projectName || "공용"} · ${STATUS_TEXT[p.status] || p.status}`;
      wrap.append(el("span", { class: `bim-chip bim-st-${p.status}`, title: p.tag ? `태그: ${p.tag}` : "", text: label }));
    }
    return wrap;
  }

  /**
   * 프로젝트 → 태그 (→ 버튼) 선택기.
   * - getChoice(): { project, tag } 또는 null
   * - onChange(choice): 선택이 바뀔 때
   * - onGo(choice): 버튼을 눌렀을 때 (label 이 없으면 버튼을 만들지 않음)
   * 한 선택기에서 고르면, 사용자가 아직 직접 손대지 않은 다른 선택기도 같은 값으로 따라온다.
   */
  function picker({ label = "", onGo, onChange, compact = false }) {
    const projectSel = el("select", { class: "bim-select bim-project", title: "유니티 프로젝트" });
    const tagSel = el("select", { class: "bim-select bim-tag", title: "태그 (유니티 폴더)" });
    const go = label ? el("button", { class: "bim-go", type: "button", text: `▶ ${label}` }) : null;
    const root = el("span", { class: `bim-picker${compact ? " bim-compact" : ""}` }, projectSel, tagSel, go);
    let touched = false;

    const getChoice = () => (projectSel.value && tagSel.value ? { project: projectSel.value, tag: tagSel.value } : null);
    const changed = () => {
      if (go) go.disabled = !getChoice();
      onChange?.(getChoice());
    };

    const fillTags = (keepValue) => {
      const projectKey = projectSel.value;
      const tags = tagsFor(projectKey);
      const remembered = keepValue ?? state.boot?.lastTagByProject?.[projectKey] ?? "";
      tagSel.replaceChildren(el("option", { value: "", text: projectKey ? "태그 선택" : "← 프로젝트 먼저" }));
      for (const t of tags) tagSel.append(el("option", { value: t.name, text: t.name }));
      tagSel.disabled = !projectKey;
      if (tags.some((t) => t.name === remembered)) tagSel.value = remembered;
      changed();
    };

    const fill = () => {
      const boot = state.boot;
      projectSel.replaceChildren(el("option", { value: "", text: boot?.projects?.length ? "프로젝트 선택" : "프로젝트 없음 (관리에서 등록)" }));
      for (const p of boot?.projects || []) projectSel.append(el("option", { value: p.key, text: projectLabel(p) }));
      if (boot?.lastProject && boot.projects.some((p) => p.key === boot.lastProject)) projectSel.value = boot.lastProject;
      fillTags();
    };

    const remember = () => {
      const choice = getChoice();
      if (!choice) return;
      if (state.boot) {
        state.boot.lastProject = choice.project;
        state.boot.lastTagByProject = { ...(state.boot.lastTagByProject || {}), [choice.project]: choice.tag };
      }
      send("rememberChoice", choice).catch(() => {});
      for (const other of document.querySelectorAll(".bim-picker")) {
        if (other !== root) other.dispatchEvent(new CustomEvent("bim-sync", { detail: choice }));
      }
    };

    projectSel.addEventListener("change", () => {
      touched = true;
      fillTags();
      remember();
    });
    tagSel.addEventListener("change", () => {
      touched = true;
      changed();
      remember();
    });
    go?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const choice = getChoice();
      if (!choice) return;
      go.disabled = true;
      go.classList.add("bim-busy");
      try {
        await onGo(choice);
      } finally {
        go.classList.remove("bim-busy");
        go.disabled = false;
      }
    });
    // 아직 직접 고르지 않은 선택기는 다른 곳에서 고른 값을 따라감
    root.addEventListener("bim-sync", (e) => {
      if (touched) return;
      projectSel.value = e.detail.project;
      fillTags(e.detail.tag);
    });
    root.refill = fill;
    root.getChoice = getChoice;
    root.flash = () => {
      root.classList.remove("bim-attn");
      void root.offsetWidth;
      root.classList.add("bim-attn");
    };
    fill();
    return root;
  }

  let toastTimer = null;
  function toast(text, kind = "info") {
    let box = document.getElementById("bim-toast");
    if (!box) {
      box = el("div", { id: "bim-toast" });
      document.body.append(box);
    }
    box.className = `bim-toast bim-toast-${kind} bim-show`;
    box.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("bim-show"), 4200);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    for (const fn of state.listeners) {
      try {
        fn(msg);
      } catch {
        /* ignore */
      }
    }
  });

  // 다크/라이트는 theme.js 가 <html class="bim-dark"> 로 정한다 (설정: boothTheme)

  window.BIM = {
    send,
    el,
    bootstrap,
    picker,
    statusChips,
    toast,
    tagsFor,
    onMessage: (fn) => state.listeners.add(fn),
    get boot() {
      return state.boot;
    },
  };
})();
