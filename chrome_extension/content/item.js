// booth.pm 상품 페이지 — 우측 하단 작은 패널: 구매 형태, 내 프로젝트 임포트 현황, 무료 파일 Unity로
(() => {
  const { el, send, picker, statusChips, toast } = window.BIM;
  const itemId = (location.pathname.match(/items\/(\d+)/) || [])[1];
  if (!itemId) return;

  const CATEGORY = { single: "구매함", full: "풀팩 구매", partial: "일부 구매", none: "" };

  async function loadItem() {
    // booth.pm 이면 같은 출처라 로그인 정보(옵션별 구매 기록)가 같이 온다
    if (location.hostname === "booth.pm") {
      const res = await fetch(`/ja/items/${itemId}.json`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return {
        id: String(j.id),
        name: j.name,
        shopName: j.shop?.name || "",
        shopUrl: j.shop?.url || "",
        thumbnail: j.images?.[0]?.resized || "",
        variations: (j.variations || []).map((v) => ({ name: v.name || "", price: Number(v.price) || 0, ppc: Number(v.past_purchase_count) || 0 })),
        freeFiles: (j.variations || []).flatMap((v) => (v.downloadable?.no_musics || []).map((f) => ({ url: f.url, name: f.name || f.file_name, variation: v.name || "" }))),
      };
    }
    const res = await send("itemJson", { id: itemId });
    return res.item;
  }

  // background 의 classifyPurchase 와 같은 규칙 (콘텐츠 스크립트는 모듈 import 불가)
  function classify(item) {
    const FULL_RE = /(full|フル|풀|全部|全て|すべて|コンプリート|complete|all[\s-]?in|パック|pack|package|まとめ|bundle|セット|set)/i;
    const paid = item.variations.filter((v) => v.price > 0);
    const bought = paid.filter((v) => v.ppc > 0);
    if (!bought.length) return "none";
    if (paid.length <= 1) return "single";
    if (bought.length === paid.length) return "full";
    const maxPrice = Math.max(...paid.map((v) => v.price));
    const full = bought.some((v) => (FULL_RE.test(v.name) && v.price >= maxPrice) || (paid.length >= 3 && v.price > Math.max(0, ...paid.filter((o) => o !== v).map((o) => o.price))));
    return full ? "full" : "partial";
  }

  async function init() {
    let item;
    try {
      item = await loadItem();
    } catch {
      return;
    }
    const category = classify(item);
    // 사지도 않았고 무료 파일도 없는 상품에는 패널을 띄우지 않는다
    if (category === "none" && !(item.freeFiles || []).length) return;
    let boot = null;
    try {
      boot = await window.BIM.bootstrap();
    } catch {
      /* 로컬 앱 꺼짐 — 패널은 구매 정보만 */
    }

    const statusSlot = el("div", { class: "bim-item-status" });
    const body = el("div", { class: "bim-panel-body" });
    const panel = el(
      "div",
      { class: "bim-panel", id: "bim-item-panel" },
      el(
        "div",
        { class: "bim-panel-head" },
        el("span", { class: "bim-logo", text: "BIM" }),
        el("span", { class: "bim-panel-title", text: CATEGORY[category] || "미구매" }),
        el("button", {
          class: "bim-x",
          type: "button",
          title: "접기/펼치기",
          text: "–",
          onclick: () => {
            panel.classList.toggle("bim-collapsed");
            chrome.storage.local.set({ itemPanelCollapsed: panel.classList.contains("bim-collapsed") });
          },
        }),
      ),
      body,
    );

    if (category === "partial") {
      const bought = item.variations.filter((v) => v.price > 0 && v.ppc > 0).map((v) => v.name);
      body.append(el("div", { class: "bim-note", text: `구매한 옵션: ${bought.join(", ")}` }));
    }
    body.append(statusSlot);

    if (!boot) {
      body.append(el("div", { class: "bim-note bim-warn", text: "로컬 앱이 꺼져 있어요" }));
    } else {
      if (category !== "none") {
        body.append(
          el("a", { class: "bim-link", href: "https://accounts.booth.pm/library", target: "_blank", text: "라이브러리에서 Unity로 받기 →" }),
        );
      }
      for (const f of item.freeFiles || []) {
        const info = { itemId: item.id, itemName: item.name, shopName: item.shopName, shopUrl: item.shopUrl, thumbnail: item.thumbnail };
        const downloadableId = (f.url.match(/downloadables\/(\d+)/) || [])[1] || "";
        body.append(
          el("div", { class: "bim-free" }, el("div", { class: "bim-free-name", text: `무료: ${f.name}` }),
            picker({
              compact: true,
              label: "Unity로",
              onGo: async (choice) => {
                try {
                  await send("unity", { url: f.url, ...choice, autoQueue: true, booth: { ...info, downloadableId, fileLabel: f.name } });
                  toast(`다운로드 시작: ${f.name}`);
                } catch (error) {
                  toast(error.message, "error");
                }
              },
            }),
          ),
        );
      }
    }
    const { itemPanelCollapsed } = await chrome.storage.local.get("itemPanelCollapsed");
    if (itemPanelCollapsed) panel.classList.add("bim-collapsed");
    document.body.append(panel);

    const refresh = async () => {
      if (!boot) return;
      try {
        const st = await send("status", { itemIds: [item.id] });
        const entry = st.items?.[item.id];
        statusSlot.replaceChildren(entry ? statusChips(entry, { full: true }) : el("span", { class: "bim-note", text: "아직 임포트한 프로젝트 없음" }));
      } catch {
        /* ignore */
      }
    };
    refresh();
    window.BIM.onMessage((msg) => msg.type === "download-done" && refresh());
  }

  init();
})();
