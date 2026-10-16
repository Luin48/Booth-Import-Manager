// accounts.booth.pm/library — 파일마다 [프로젝트▾][태그▾][▶ Unity로] 붙이기
(() => {
  const { el, send, picker, statusChips, toast, PRESET } = window.BIM;
  const idFromHref = (href, kind) => (String(href || "").match(new RegExp(`${kind}/(\\d+)`)) || [])[1] || "";

  // 라이브러리(div.bg-white 카드)와 주문 상세(.sheet + .legacy-list-item) 둘 다 지원
  function findCards() {
    const cards = new Set();
    for (const btn of document.querySelectorAll(".js-download-button[data-href]")) {
      const card = btn.closest("div.bg-white") || btn.closest(".sheet") || btn.closest("[class*='rounded']");
      if (card) cards.add(card);
    }
    return [...cards];
  }

  // 부스 상품 링크만 (X/페이스북 공유 링크에도 /items/ 가 들어 있어서 걸러냄)
  const isItemLink = (a) => /^https:\/\/([\w-]+\.)?booth\.pm\/(?:[\w-]+\/)?items\/\d+/.test(a.href);

  function cardInfo(card) {
    const itemLinks = [...card.querySelectorAll('a[href*="/items/"]')].filter(isItemLink);
    const link = itemLinks[0];
    const shopBlock = card.closest(".l-order-detail-by-shop");
    const shop =
      shopBlock?.querySelector(".l-order-detail-sheet-group-header a") ||
      [...card.querySelectorAll("a")].find((a) => /^https:\/\/[^/]+\.booth\.pm\/?$/.test(a.href) && !a.href.includes("accounts."));
    const title =
      itemLinks.map((a) => a.textContent.trim()).find(Boolean) ||
      card.querySelector(".font-bold")?.textContent ||
      "";
    return {
      itemId: idFromHref(link?.href, "items"),
      itemName: title.trim(),
      shopName: (shop?.textContent || "").trim(),
      shopUrl: shop?.href || "",
      thumbnail: card.querySelector("img")?.src || "", // 절대 주소 (사이드패널에서도 보이게)
    };
  }

  function fileRows(card) {
    const seen = new Set();
    const rows = [];
    for (const btn of card.querySelectorAll(".js-download-button[data-href]")) {
      const url = btn.dataset.href;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const legacy = btn.closest(".legacy-list-item");
      const row = legacy || btn.closest(".desktop\\:flex") || btn.parentElement?.parentElement?.parentElement;
      const fileLabel = ((legacy ? legacy.querySelector("b") : row?.querySelector(".min-w-0"))?.textContent || "").trim();
      rows.push({ btn, row, url, downloadableId: idFromHref(url, "downloadables"), fileLabel });
    }
    return rows;
  }

  const isLibrary = location.pathname.startsWith("/library");
  const collapsers = []; // 카드마다 setOpen(open)
  let collapseByDefault = false;
  let pageSize = 10;
  const PAGE_SIZES = [10, 20, 30, 50];

  // ---- 페이지당 표시 개수 (부스는 10개 고정 → 다음 페이지들을 받아 이어 붙인다) ----
  const pageParam = (url) => Math.max(1, parseInt(new URL(url, location.href).searchParams.get("page") || "1", 10) || 1);
  function pageUrl(boothPage) {
    const u = new URL(location.href);
    if (boothPage <= 1) u.searchParams.delete("page");
    else u.searchParams.set("page", String(boothPage));
    return u.pathname + u.search;
  }
  function lastBoothPage(root = document) {
    let max = pageParam(location.href);
    for (const a of root.querySelectorAll(".pager a[href]")) max = Math.max(max, pageParam(a.getAttribute("href")));
    return max;
  }

  // 받아온 카드의 Download 칸은 부스 스크립트가 그려주지 않으므로 직접 버튼을 만든다
  function mountDownloadButtons(card) {
    for (const holder of card.querySelectorAll(".js-download-button[data-href]")) {
      if (holder.childElementCount) continue;
      const href = holder.dataset.href;
      const external = holder.dataset.isExternal === "true";
      const btn = el("button", {
        type: "button",
        class: "charcoal-button !w-fit",
        "data-variant": "Default",
        "data-size": "S",
        text: holder.dataset.label || "Download",
        onclick: () => (external ? window.open(href, "_blank", "noopener") : (location.href = href)),
      });
      holder.append(el("div", { class: "relative w-fit" }, btn));
    }
  }

  function renderPager(current, total, k) {
    const old = document.querySelector(".pager:not(.bim-pager)");
    if (!old) return;
    old.style.display = "none";
    document.querySelector(".bim-pager")?.remove();
    const item = (v, text, extra = {}) =>
      el("li", { class: v === current && !extra.arrow ? "current" : "" }, el("a", { class: "nav-item", href: pageUrl((v - 1) * k + 1), text, ...extra.attrs }));
    const nums = [];
    const from = Math.max(1, current - 2);
    const to = Math.min(total, current + 2);
    if (current > 1) nums.push(item(current - 1, "‹", { arrow: true, attrs: { rel: "prev", title: "이전" } }));
    if (from > 1) nums.push(item(1, "1"), from > 2 ? el("li", { class: "page gap", text: "…" }) : null);
    for (let v = from; v <= to; v += 1) nums.push(item(v, String(v)));
    if (to < total) nums.push(to < total - 1 ? el("li", { class: "page gap", text: "…" }) : null, item(total, String(total)));
    if (current < total) nums.push(item(current + 1, "›", { arrow: true, attrs: { rel: "next", title: "다음" } }));
    old.after(el("div", { class: "pager border-0 bim-pager" }, el("nav", {}, el("ul", {}, nums.filter(Boolean)))));
  }

  async function expandPage(firstCard) {
    if (!isLibrary || pageSize <= 10 || !firstCard) return;
    const k = pageSize / 10;
    const page = pageParam(location.href);
    const start = Math.floor((page - 1) / k) * k + 1;
    if (start !== page) {
      location.replace(pageUrl(start)); // 묶음의 첫 페이지로 맞춘다
      return "redirect";
    }
    const last = lastBoothPage();
    const current = Math.floor((start - 1) / k) + 1;
    const total = Math.ceil(last / k);
    renderPager(current, total, k);
    const container = firstCard.parentElement;
    const pager = document.querySelector(".pager:not(.bim-pager)");
    const loading = el("div", { class: "bim-loading-more", text: `다음 ${Math.min(start + k - 1, last) - start}페이지 불러오는 중…` });
    (pager || container.lastElementChild).before(loading);
    const pages = [];
    for (let p = start + 1; p <= Math.min(start + k - 1, last); p += 1) pages.push(p);
    const docs = await Promise.all(
      pages.map((p) =>
        fetch(pageUrl(p), { credentials: "include" })
          .then((r) => (r.ok ? r.text() : ""))
          .then((t) => (t ? new DOMParser().parseFromString(t, "text/html") : null))
          .catch(() => null),
      ),
    );
    const added = [];
    for (const d of docs) {
      if (!d) continue;
      const seen = new Set();
      for (const b of d.querySelectorAll(".js-download-button[data-href]")) {
        const c = b.closest("div.bg-white");
        if (!c || seen.has(c)) continue;
        seen.add(c);
        const card = document.importNode(c, true);
        mountDownloadButtons(card);
        loading.before(card);
        added.push(card);
      }
    }
    loading.remove();
    return added;
  }

  // 라이브러리 상단: 다운로드 항목 전체 펼치기/접기 + 기본값 기억
  // ---- 에셋 프리셋: 받을 파일 + 저장 태그만 모아 두기 ----
  const preset = { list: [], active: "", rows: [], cardButtons: [] };
  const seenItems = {}; // 라이브러리에서 본 상품별 다운로드 목록 → 프리셋 업데이트 표시용
  function flushSeen() {
    const items = { ...seenItems };
    for (const k of Object.keys(seenItems)) delete seenItems[k];
    if (Object.keys(items).length) api("/api/items/seen", { items }).catch(() => {});
  }
  const api = (path, body) => send("api", { path, method: body === undefined ? "GET" : "POST", body });

  async function loadPresets() {
    try {
      const res = await api("/api/presets");
      preset.list = res.presets || [];
      preset.active = preset.list.some((p) => p.id === res.active) ? res.active : "";
    } catch {
      preset.list = [];
    }
    renderPresetUi();
  }

  const activePreset = () => preset.list.find((p) => p.id === preset.active) || null;

  function renderPresetUi() {
    const sel = document.getElementById("bim-preset-select");
    if (sel) {
      sel.replaceChildren(
        el("option", { value: "", text: "담기 끔" }),
        ...preset.list.map((p) => el("option", { value: p.id, text: `${p.name} (${p.items.length})` })),
        el("option", { value: "__new__", text: "＋ 새 프리셋…" }),
      );
      sel.value = preset.active;
    }
    const p = activePreset();
    const inPreset = new Map((p?.items || []).map((x) => [x.downloadableId, x]));
    for (const r of preset.rows) {
      r.btn.classList.toggle("bim-hidden-soft", !p);
      const hit = inPreset.get(r.file.downloadableId);
      r.btn.classList.toggle("bim-in-preset", Boolean(hit));
      r.btn.textContent = hit ? `✓ ${hit.tag}` : "＋ 프리셋";
      r.btn.title = !p ? "" : hit ? `"${p.name}"에 ${hit.tag} 태그로 들어 있어요 (같은 태그로 누르면 빼기, 다른 태그를 고르고 누르면 태그 변경)` : `"${p.name}" 프리셋에 담기 (위에서 고른 태그로)`;
    }
    for (const b of preset.cardButtons) b.classList.toggle("bim-hidden-soft", !p);
    window.BIM.setPresetMode(p ? p.name : null);
  }

  async function presetAdd(entries, mode, picker) {
    const p = activePreset();
    if (!p) return;
    const choice = picker.getChoice();
    if (!choice?.tag) {
      toast("상품 이름 아래에서 저장할 태그를 먼저 고르세요 (프로젝트 칸은 '📁 프리셋')", "warn");
      picker.flash();
      return;
    }
    try {
      const updated = await api("/api/presets/edit", { presetId: p.id, mode, entries: entries.map((e) => ({ ...e, tag: choice.tag })) });
      preset.list = preset.list.map((x) => (x.id === updated.id ? updated : x));
      renderPresetUi();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function presetControl() {
    const sel = el("select", { id: "bim-preset-select", class: "bim-select", title: "고른 프리셋에 파일과 태그를 담아 둬요" });
    const name = el("input", { type: "text", class: "bim-input bim-hidden-soft", placeholder: "새 프리셋 이름" });
    const make = el("button", { class: "bim-toggle bim-hidden-soft", type: "button", text: "만들기" });
    const showNew = (on) => {
      name.classList.toggle("bim-hidden-soft", !on);
      make.classList.toggle("bim-hidden-soft", !on);
      if (on) name.focus();
    };
    sel.addEventListener("change", async () => {
      if (sel.value === "__new__") {
        sel.value = preset.active;
        showNew(true);
        return;
      }
      preset.active = sel.value;
      showNew(false);
      await api("/api/presets/active", { presetId: preset.active }).catch(() => {});
      renderPresetUi();
    });
    const create = async () => {
      try {
        const p = await api("/api/presets/create", { name: name.value });
        preset.list.push(p);
        preset.active = p.id;
        await api("/api/presets/active", { presetId: p.id });
        name.value = "";
        showNew(false);
        renderPresetUi();
        toast(`프리셋 "${p.name}" 만들었어요 — 파일 옆 ＋ 프리셋으로 담으세요`, "ok");
      } catch (error) {
        toast(error.message, "error");
      }
    };
    make.addEventListener("click", create);
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") create();
      if (e.key === "Escape") showNew(false);
    });
    return el("span", { class: "bim-libbar-preset" }, el("span", { class: "bim-libbar-label", text: "에셋 프리셋" }), sel, name, make);
  }

  // 맨 위 BIM 줄: (라이브러리) 다운로드 항목 펼치기/접기·페이지당 + (공통) 에셋 프리셋 담기
  function libraryBar(firstCard) {
    if (!firstCard || document.getElementById("bim-libbar")) return;
    const parts = [el("span", { class: "bim-logo", text: "BIM" })];
    if (isLibrary) {
      const remember = el("input", { type: "checkbox", checked: collapseByDefault });
      remember.checked = collapseByDefault;
      remember.addEventListener("change", () => chrome.storage.local.set({ libraryCollapsed: remember.checked }));
      const sizeSel = el("select", { class: "bim-select bim-pagesize", title: "한 페이지에 보여줄 상품 수" }, PAGE_SIZES.map((n) => el("option", { value: String(n), text: `${n}개` })));
      sizeSel.value = String(pageSize);
      sizeSel.addEventListener("change", async () => {
        const n = Number(sizeSel.value);
        await chrome.storage.local.set({ libraryPageSize: n });
        // 지금 보고 있는 첫 상품이 들어있는 묶음으로 이동
        const first = pageParam(location.href);
        location.href = pageUrl(Math.floor((first - 1) / (n / 10)) * (n / 10) + 1);
      });
      parts.push(
        el("span", { class: "bim-libbar-label", text: "다운로드 항목" }),
        el("button", { class: "bim-toggle", type: "button", text: "▾ 모두 펼치기", onclick: () => collapsers.forEach((f) => f(true)) }),
        el("button", { class: "bim-toggle", type: "button", text: "▸ 모두 접기", onclick: () => collapsers.forEach((f) => f(false)) }),
        el("label", { class: "bim-libbar-check" }, remember, el("span", { text: "처음에 접어두기" })),
        el("label", { class: "bim-libbar-size" }, el("span", { text: "페이지당" }), sizeSel),
      );
    }
    const bar = el("div", { id: "bim-libbar", class: "bim-libbar" }, ...parts);
    bar.append(el("div", { class: "bim-libbar-row" }, presetControl()));
    firstCard.before(bar);
    renderPresetUi();
  }

  const registry = []; // { downloadableId, statusSlot, card }
  const cardRegistry = []; // { itemId, slot }

  async function unity(choice, info, file) {
    const booth = { ...info, downloadableId: file.downloadableId, fileLabel: file.fileLabel };
    const status = lastStatus.downloadables?.[file.downloadableId];
    try {
      const res = await send("unity", {
        url: file.url,
        tag: choice.tag,
        project: choice.project,
        autoQueue: true,
        preferLocal: Boolean(status?.present),
        booth,
      });
      toast(
        res.mode === "requeue" ? `이미 받은 파일 → ${projectName(choice.project)} / ${choice.tag} 대기열에 추가` : `다운로드 시작: ${file.fileLabel}`,
        "info",
      );
    } catch (error) {
      toast(error.message, "error");
    }
  }

  let lastStatus = { items: {}, downloadables: {} };
  async function refreshStatus() {
    const itemIds = [...new Set(cardRegistry.map((c) => c.itemId).filter(Boolean))];
    const downloadableIds = [...new Set(registry.map((r) => r.downloadableId).filter(Boolean))];
    try {
      lastStatus = await send("status", { itemIds, downloadableIds });
    } catch {
      return;
    }
    renderChips();
  }

  // 배지는 하나만: 상품 선택기에서 고른 프로젝트 기준 (+N, 마우스를 올리면 전체)
  function renderChips(onlyCard) {
    for (const r of registry) {
      if (onlyCard && r.card !== onlyCard) continue;
      r.statusSlot.replaceChildren(statusChips(lastStatus.downloadables?.[r.downloadableId], { selected: r.card.selected() }));
    }
    for (const c of cardRegistry) {
      if (onlyCard && c !== onlyCard) continue;
      c.slot.replaceChildren(statusChips(lastStatus.items?.[c.itemId], { selected: c.selected() }));
    }
  }

  function decorate(card) {
    if (card.dataset.bimDone) return;
    card.dataset.bimDone = "1";
    const info = cardInfo(card);
    const files = fileRows(card);
    if (!files.length) return;

    // 에셋명 바로 아래: 이 상품의 프로젝트·태그 지정 (하나만) + 상태 배지
    const cardSlot = el("span", { class: "bim-card-status" });
    const cardEntry = { itemId: info.itemId, slot: cardSlot, selected: () => "" };
    cardRegistry.push(cardEntry);
    const fileButtons = [];
    const cardPicker = picker({
      compact: true,
      onChange: (choice, project) => {
        if (cardEntry.ready) renderChips(cardEntry);
        const isPreset = project === PRESET;
        for (const b of fileButtons) {
          b.classList.toggle("bim-off", !choice);
          b.classList.toggle("bim-hidden-soft", isPreset); // 프리셋 모드에서는 ＋ 프리셋만
          b.title = !choice ? "위에서 프로젝트와 태그를 먼저 고르세요" : `${projectName(choice.project)} / ${choice.tag} 로 임포트`;
        }
      },
    });
    cardEntry.selected = () => cardPicker.getChoice()?.project || cardPicker.querySelector(".bim-project")?.value || "";
    cardEntry.ready = true;
    // 이 상품의 다운로드 항목 묶음 (라이브러리: 카드의 두 번째 칸 / 주문 상세: .list)
    const list = card.querySelector(".list");
    const filesBox = list || files[0].row?.parentElement || null;
    const toggle = el("button", { class: "bim-toggle", type: "button", title: "다운로드 항목 접기/펼치기" });
    const setOpen = (open) => {
      if (!filesBox) return;
      filesBox.classList.toggle("bim-files-collapsed", !open);
      toggle.textContent = `${open ? "▾" : "▸"} 파일 ${files.length}개`;
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      setOpen(filesBox.classList.contains("bim-files-collapsed"));
    });
    collapsers.push(setOpen);
    setOpen(!collapseByDefault);
    const itemFiles = files.map((f) => ({ id: f.downloadableId, label: f.fileLabel }));
    if (isLibrary && info.itemId) seenItems[info.itemId] = itemFiles;
    const fileEntries = () => files.map((f) => ({ ...info, downloadableId: f.downloadableId, url: f.url, fileLabel: f.fileLabel, itemFiles }));
    const allToPreset = el("button", {
      class: "bim-toggle bim-preset-all bim-hidden-soft",
      type: "button",
      title: "이 상품의 파일을 전부 프리셋에 담기 (고른 태그로)",
      text: "＋ 전부 프리셋",
      onclick: (e) => {
        e.preventDefault();
        presetAdd(fileEntries(), "add", cardPicker);
      },
    });
    preset.cardButtons.push(allToPreset);
    const bar = el("div", { class: "bim-cardbar" }, el("span", { class: "bim-logo", text: "BIM" }), filesBox ? toggle : null, cardSlot, allToPreset, cardPicker);
    if (list) list.before(bar);
    else card.firstElementChild?.after(bar);

    // 다운로드 항목: 기존 Download 버튼 왼쪽에 [Unity로] 버튼만
    for (const file of files) {
      const statusSlot = el("span", { class: "bim-file-status" });
      registry.push({ downloadableId: file.downloadableId, statusSlot, card: cardEntry });
      const btn = el("button", {
        class: "bim-go bim-file-go",
        type: "button",
        text: "▶ Unity로",
        onclick: async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const choice = cardPicker.getChoice();
          if (choice?.project === PRESET) {
            toast("프리셋 모드에서는 ＋ 프리셋으로 담아요. 유니티로 보내려면 프로젝트를 고르세요", "warn");
            return;
          }
          if (!choice) {
            toast("상품 이름 아래에서 프로젝트와 태그를 먼저 고르세요", "warn");
            cardPicker.flash();
            return;
          }
          btn.disabled = true;
          btn.classList.add("bim-busy");
          try {
            await unity(choice, info, file);
          } finally {
            btn.disabled = false;
            btn.classList.remove("bim-busy");
          }
        },
      });
      fileButtons.push(btn);
      const presetBtn = el("button", {
        class: "bim-preset-btn bim-hidden-soft",
        type: "button",
        text: "＋ 프리셋",
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          presetAdd([{ ...info, downloadableId: file.downloadableId, url: file.url, fileLabel: file.fileLabel, itemFiles: files.map((f) => ({ id: f.downloadableId, label: f.fileLabel })) }], "toggle", cardPicker);
        },
      });
      preset.rows.push({ file, btn: presetBtn });
      // Download 버튼을 감싼 칸이 가로 줄(flex) 안에 있으면 그 칸 앞에, 아니면 버튼 바로 앞에
      const wrap = file.btn.parentElement;
      const anchor = wrap && wrap.parentElement && getComputedStyle(wrap.parentElement).display.includes("flex") ? wrap : file.btn;
      anchor.before(el("span", { class: "bim-inline" }, statusSlot, presetBtn, btn));
      // 부스 기본 Download 버튼을 눌러도 상품 정보는 남긴다 (태그 없이 보관 폴더로)
      file.btn.addEventListener(
        "click",
        () => send("noteClick", { downloadableId: file.downloadableId, booth: { ...info, downloadableId: file.downloadableId, fileLabel: file.fileLabel } }).catch(() => {}),
        true,
      );
    }
    // 처음 상태 반영 (기억해 둔 프로젝트·태그가 있으면 바로 활성)
    const initial = cardPicker.getChoice();
    for (const b of fileButtons) b.classList.toggle("bim-off", !initial);
  }

  function projectName(key) {
    return window.BIM.boot?.projects?.find((p) => p.key === key)?.name || key;
  }

  function banner(text, actionLabel, action) {
    const existing = document.getElementById("bim-banner");
    existing?.remove();
    const box = el(
      "div",
      { id: "bim-banner", class: "bim-banner" },
      el("strong", { text: "Booth Import Manager" }),
      el("span", { text }),
      actionLabel ? el("button", { class: "bim-go", type: "button", text: actionLabel, onclick: action }) : null,
    );
    const main = document.querySelector("main") || document.body;
    main.prepend(box);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.presetsVersion || changes.activePreset)) loadPresets();
  });

  // 프로젝트 목록이 나중에 생기면 안내 배너를 치운다
  document.addEventListener("bim-boot", (e) => {
    if (e.detail?.projects?.length) document.getElementById("bim-banner")?.remove();
  });

  async function init() {
    try {
      const boot = await window.BIM.bootstrap();
      if (!boot.projects.length) banner("아직 유니티 프로젝트 목록이 없어요. BIM 패키지를 설치한 유니티 프로젝트를 하나 켜거나, 관리 페이지에서 프로젝트 폴더를 등록하세요.", "관리 페이지 열기", () => send("openManage", { hash: "#projects" }));
    } catch (error) {
      banner(`${error.message}`, "다시 시도", () => location.reload());
      return;
    }
    if (isLibrary) {
      const prefs = await chrome.storage.local.get(["libraryCollapsed", "libraryPageSize"]);
      collapseByDefault = prefs.libraryCollapsed !== false;
      pageSize = PAGE_SIZES.includes(prefs.libraryPageSize) ? prefs.libraryPageSize : 10;
    }
    const cards = findCards();
    if (pageSize > 10 && pageParam(location.href) % (pageSize / 10) !== 1 % (pageSize / 10)) {
      if ((await expandPage(cards[0])) === "redirect") return;
    }
    libraryBar(cards[0]);
    cards.forEach(decorate);
    flushSeen();
    loadPresets();
    refreshStatus();
    const more = await expandPage(cards[0]);
    if (Array.isArray(more) && more.length) {
      findCards().forEach(decorate);
      flushSeen();
      refreshStatus();
    }
  }

  window.BIM.onMessage((msg) => {
    if (msg.type === "download-done") {
      const r = msg.result || {};
      if (r.queueError) toast(`큐 실패: ${r.queueError}`, "error");
      else if (r.status === "queued") toast(`${r.projectName || ""} 대기열 등록 ✓ ${r.running ? "(곧 임포트)" : "(유니티 켜면 임포트)"}`, "ok");
      else if (r.status === "no_package") toast(`${r.filename}: unitypackage 없음 (보관 폴더에 저장됨)`, "warn");
      else toast(`보관 폴더로 이동: ${r.filename}`, "info");
      refreshStatus();
    } else if (msg.type === "download-error" || msg.type === "download-failed") {
      toast(msg.error || "다운로드 실패", "error");
    }
  });

  // 상태는 주기적으로 갱신 (유니티가 임포트를 끝내면 배지 변경)
  setInterval(() => document.visibilityState === "visible" && registry.length && refreshStatus(), 8000);
  init();
})();
