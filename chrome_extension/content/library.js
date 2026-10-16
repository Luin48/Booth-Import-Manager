// accounts.booth.pm/library — 파일마다 [프로젝트▾][태그▾][▶ Unity로] 붙이기
(() => {
  const { el, send, picker, statusChips, toast } = window.BIM;
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

  function cardInfo(card) {
    const link = card.querySelector('a[href*="/items/"]');
    const shopBlock = card.closest(".l-order-detail-by-shop");
    const shop =
      shopBlock?.querySelector(".l-order-detail-sheet-group-header a") ||
      [...card.querySelectorAll("a")].find((a) => /^https:\/\/[^/]+\.booth\.pm\/?$/.test(a.href) && !a.href.includes("accounts."));
    const title =
      card.querySelector(".font-bold")?.textContent ||
      [...card.querySelectorAll('a[href*="/items/"]')].map((a) => a.textContent.trim()).find(Boolean) ||
      "";
    return {
      itemId: idFromHref(link?.href, "items"),
      itemName: title.trim(),
      shopName: (shop?.textContent || "").trim(),
      shopUrl: shop?.href || "",
      thumbnail: card.querySelector("img")?.getAttribute("src") || "",
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
      toast(res.mode === "requeue" ? `이미 받은 파일 → ${choice.tag} 큐에 추가` : `다운로드 시작: ${file.fileLabel}`, "info");
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
    for (const r of registry) r.statusSlot.replaceChildren(statusChips(lastStatus.downloadables?.[r.downloadableId]));
    for (const c of cardRegistry) c.slot.replaceChildren(statusChips(lastStatus.items?.[c.itemId]));
  }

  function decorate(card) {
    if (card.dataset.bimDone) return;
    card.dataset.bimDone = "1";
    const info = cardInfo(card);
    const files = fileRows(card);
    if (!files.length) return;

    // 카드 상단: 상품 전체 상태 + "전부" 버튼
    const cardSlot = el("span", { class: "bim-card-status" });
    cardRegistry.push({ itemId: info.itemId, slot: cardSlot });
    const allPicker = picker({
      label: `전부 Unity로 (${files.length})`,
      compact: true,
      onGo: async (choice) => {
        for (const f of files) {
          await unity(choice, info, f);
          await new Promise((r) => setTimeout(r, 600));
        }
      },
    });
    const bar = el("div", { class: "bim-cardbar" }, el("span", { class: "bim-logo", text: "BIM" }), cardSlot, allPicker);
    const list = card.querySelector(".list");
    if (list) list.before(bar);
    else card.firstElementChild?.after(bar);

    for (const file of files) {
      const statusSlot = el("span", { class: "bim-file-status" });
      registry.push({ downloadableId: file.downloadableId, statusSlot });
      const line = el("div", { class: "bim-fileline" }, statusSlot, picker({ onGo: (choice) => unity(choice, info, file) }));
      (file.row || file.btn).after(line);
      // 부스 기본 Download 버튼을 눌러도 상품 정보는 남긴다 (태그 없이 보관 폴더로)
      file.btn.addEventListener(
        "click",
        () => send("noteClick", { downloadableId: file.downloadableId, booth: { ...info, downloadableId: file.downloadableId, fileLabel: file.fileLabel } }).catch(() => {}),
        true,
      );
    }
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

  async function init() {
    try {
      const boot = await window.BIM.bootstrap();
      if (!boot.projects.length) banner("등록된 유니티 프로젝트가 없어요.", "관리 페이지 열기", () => send("openManage", { hash: "#projects" }));
    } catch (error) {
      banner(`${error.message}`, "다시 시도", () => location.reload());
      return;
    }
    findCards().forEach(decorate);
    refreshStatus();
  }

  window.BIM.onMessage((msg) => {
    if (msg.type === "download-done") {
      const r = msg.result || {};
      if (r.queueError) toast(`큐 실패: ${r.queueError}`, "error");
      else if (r.status === "queued") toast(`${r.projectName || ""} 큐 등록 ✓ ${r.running ? "(곧 임포트)" : "(유니티 켜면 임포트)"}`, "ok");
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
