// BOOTH 관련 공통 로직.
// page* 함수들은 chrome.scripting.executeScript 로 booth 탭 안에 주입되어 실행된다.
// 그래서 바깥 변수를 참조하면 안 되고(직렬화됨), 필요한 건 전부 함수 안에 있어야 한다.

// ---- 구매 분류 ---------------------------------------------------------
const FULL_RE = /(full|フル|풀|全部|全て|すべて|コンプリート|complete|all[\s-]?in|パック|pack|package|まとめ|bundle|セット|set)/i;

/**
 * 상품 JSON(variations[].past_purchase_count)으로 구매 형태를 판별.
 *  - single  : 유료 옵션이 1개뿐인 상품을 구매 → "구매"
 *  - full    : 유료 옵션 전부 구매, 또는 풀세트류 옵션(이름/최고가) 구매 → "풀팩 구매"
 *  - partial : 일부 옵션만 구매 → "일부 구매"
 *  - none    : 이 계정에서 구매 기록이 안 보임
 */
export function classifyPurchase(item) {
  const variations = Array.isArray(item?.variations) ? item.variations : [];
  const paid = variations.filter((v) => Number(v.price) > 0);
  const bought = paid.filter((v) => Number(v.ppc ?? v.past_purchase_count) > 0);
  const boughtNames = bought.map((v) => v.name || "");
  const anyPurchase = bought.length > 0 || Number(item?.ppc ?? item?.past_purchase_count) > 0;

  if (!anyPurchase) return { category: "none", boughtNames, paidCount: paid.length };
  if (paid.length <= 1) return { category: "single", boughtNames, paidCount: paid.length };
  if (bought.length === paid.length) return { category: "full", boughtNames, paidCount: paid.length };

  const maxPrice = Math.max(...paid.map((v) => Number(v.price) || 0));
  const othersMax = (v) => Math.max(0, ...paid.filter((o) => o !== v).map((o) => Number(o.price) || 0));
  const fullBought = bought.some((v) => {
    const price = Number(v.price) || 0;
    if (FULL_RE.test(v.name || "") && price >= maxPrice) return true;
    // 이름에 표시가 없어도, 옵션이 3개 이상이고 혼자 제일 비싸면 풀세트로 본다
    return paid.length >= 3 && price > othersMax(v);
  });
  return { category: fullBought ? "full" : "partial", boughtNames, paidCount: paid.length };
}

export const CATEGORY_LABEL = {
  single: "구매",
  full: "풀팩 구매",
  partial: "일부 구매",
  none: "구매 기록 없음",
};

export function slimItem(json) {
  return {
    id: String(json.id),
    name: json.name || "",
    wished: Boolean(json.wished),
    ppc: Number(json.past_purchase_count) || 0,
    shopName: json.shop?.name || "",
    shopUrl: json.shop?.url || "",
    thumbnail: json.images?.[0]?.resized || json.images?.[0]?.original || "",
    variations: (json.variations || []).map((v) => ({
      id: v.id,
      name: v.name || "",
      price: Number(v.price) || 0,
      type: v.type,
      ppc: Number(v.past_purchase_count) || 0,
    })),
    freeFiles: (json.variations || []).flatMap((v) =>
      (v.downloadable?.no_musics || []).map((f) => ({
        url: f.url,
        name: f.name || `${f.file_name}${f.file_extension || ""}`,
        size: f.file_size || "",
        variation: v.name || "",
      })),
    ),
  };
}

// ---- 주입용: accounts.booth.pm 에서 구매 상품 목록 수집 -------------------
export async function pageCollectLibrary(maxPages) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const found = new Map();
  const parse = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let cards = [...doc.querySelectorAll(".l-library-item-thumbnail")].map((img) => img.closest("div.bg-white") || img.parentElement?.parentElement?.parentElement);
    if (!cards.length) cards = [...doc.querySelectorAll(".js-download-button")].map((b) => b.closest("div.bg-white"));
    let count = 0;
    for (const card of cards) {
      if (!card) continue;
      const link = card.querySelector('a[href*="/items/"]');
      const id = link?.href.match(/items\/(\d+)/)?.[1];
      if (!id) continue;
      count += 1;
      if (!found.has(id)) {
        found.set(id, {
          id,
          name: (card.querySelector(".font-bold")?.textContent || "").trim(),
          thumbnail: card.querySelector("img")?.getAttribute("src") || "",
        });
      }
    }
    return count;
  };
  for (const base of ["/library", "/library/gifts"]) {
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await fetch(`${base}?page=${page}`, { credentials: "include" });
      if (!res.ok) break;
      const count = parse(await res.text());
      if (!count) break;
      await sleep(250);
    }
  }
  return [...found.values()];
}

// ---- 주입용: 라이브러리 전체에서 상품별 다운로드 파일 목록 (프리셋 업데이트 확인) ----
export async function pageCollectLibraryFiles(maxPages) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const items = {};
  const parse = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const cards = new Set([...doc.querySelectorAll(".js-download-button[data-href]")].map((b) => b.closest("div.bg-white")).filter(Boolean));
    for (const card of cards) {
      const link = [...card.querySelectorAll('a[href*="/items/"]')].find((a) => /booth\.pm\/(?:[\w-]+\/)?items\/\d+/.test(a.href));
      const id = link?.href.match(/items\/(\d+)/)?.[1];
      if (!id) continue;
      const files = items[id] || [];
      for (const b of card.querySelectorAll(".js-download-button[data-href]")) {
        const dl = b.dataset.href.match(/downloadables\/(\d+)/)?.[1];
        if (!dl || files.some((f) => f.id === dl)) continue;
        const row = b.closest(".desktop\\:flex") || b.parentElement?.parentElement?.parentElement;
        files.push({ id: dl, label: (row?.querySelector(".min-w-0")?.textContent || "").trim() });
      }
      items[id] = files;
    }
    return cards.size;
  };
  for (const base of ["/library", "/library/gifts"]) {
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await fetch(`${base}?page=${page}`, { credentials: "include" });
      if (!res.ok) break;
      const count = parse(await res.text());
      if (!count) break;
      await sleep(250);
    }
  }
  return items;
}

// ---- 주입용: 라이브러리 전체 목록 (썸네일 매칭용: 상품·샵·썸네일·파일 이름) ----------
export async function pageCollectLibraryCatalog(maxPages) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const items = new Map();
  const isItem = (a) => /booth\.pm\/(?:[\w-]+\/)?items\/\d+/.test(a.href) && !/twitter|x\.com|intent/.test(a.href);
  const parse = (html, gift) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const cards = new Set(
      [...doc.querySelectorAll(".js-download-button[data-href], .l-library-item-thumbnail")].map((b) => b.closest("div.bg-white")).filter(Boolean),
    );
    for (const card of cards) {
      const links = [...card.querySelectorAll('a[href*="/items/"]')].filter(isItem);
      const id = links[0]?.href.match(/items\/(\d+)/)?.[1];
      if (!id) continue;
      const shop = [...card.querySelectorAll("a")].find((a) => /^https:\/\/[^/]+\.booth\.pm\/?$/.test(a.href) && !a.href.includes("accounts."));
      const entry = items.get(id) || {
        itemId: id,
        name: (links.map((a) => a.textContent.trim()).find(Boolean) || card.querySelector(".font-bold")?.textContent || "").trim(),
        shopName: (shop?.textContent || "").trim(),
        shopUrl: shop?.href || "",
        thumbnail: card.querySelector("img.l-library-item-thumbnail, img")?.getAttribute("src") || "",
        gift,
        files: [],
      };
      for (const b of card.querySelectorAll(".js-download-button[data-href]")) {
        const dl = b.dataset.href.match(/downloadables\/(\d+)/)?.[1];
        if (!dl || entry.files.some((f) => f.id === dl)) continue;
        const row = b.closest(".desktop\\:flex") || b.parentElement?.parentElement?.parentElement;
        entry.files.push({ id: dl, label: (row?.querySelector(".min-w-0")?.textContent || "").trim() });
      }
      items.set(id, entry);
    }
    return cards.size;
  };
  for (const [base, gift] of [["/library", false], ["/library/gifts", true]]) {
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await fetch(`${base}?page=${page}`, { credentials: "include" });
      if (!res.ok) break;
      if (!parse(await res.text(), gift)) break;
      await sleep(250);
    }
  }
  return [...items.values()];
}

// ---- 주입용: booth.pm 에서 상품 JSON 여러 개 조회 -------------------------
export async function pageFetchItems(ids) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  for (const id of ids) {
    try {
      const res = await fetch(`/ja/items/${id}.json`, { credentials: "include", headers: { Accept: "application/json" } });
      if (!res.ok) {
        out.push({ id: String(id), error: `HTTP ${res.status}` });
      } else {
        const j = await res.json();
        out.push({
          id: String(j.id),
          name: j.name || "",
          wished: Boolean(j.wished),
          ppc: Number(j.past_purchase_count) || 0,
          thumbnail: j.images?.[0]?.resized || "",
          variations: (j.variations || []).map((v) => ({ name: v.name || "", price: Number(v.price) || 0, type: v.type, ppc: Number(v.past_purchase_count) || 0 })),
        });
      }
    } catch (e) {
      out.push({ id: String(id), error: String(e) });
    }
    await sleep(250);
  }
  return out;
}

// ---- 주입용: accounts.booth.pm 에서 찜목록 변경 --------------------------
// plan = { items: [{ id, action: "remove" | "list", listName }], managedNames: [..] }
export async function pageApplyWishlist(plan) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-CSRF-Token": csrf,
    "X-Requested-With": "XMLHttpRequest",
  };
  const call = async (method, path, body) => {
    const res = await fetch(path, { method, credentials: "include", headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  };
  const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
  const normNames = (data) => {
    const arr = Array.isArray(data) ? data : pick(data || {}, "wishListNames", "wish_list_names", "items") || [];
    return arr.map((n) => ({ code: String(pick(n, "code", "wishListNameCode", "wish_list_name_code", "id") ?? ""), name: String(pick(n, "name") ?? "") }));
  };

  const results = [];
  const needLists = plan.items.some((i) => i.action === "list");
  let names = [];
  if (needLists) {
    const listed = await call("GET", "/wish_list_names.json");
    if (!listed.ok) return { error: `리스트 목록 조회 실패 (HTTP ${listed.status})`, results };
    names = normNames(listed.data);
    const wanted = [...new Set(plan.items.filter((i) => i.action === "list").map((i) => i.listName))];
    for (const name of wanted) {
      if (names.some((n) => n.name === name)) continue;
      const created = await call("POST", "/wish_list_names.json", { name });
      if (!created.ok) return { error: `리스트 "${name}" 만들기 실패 (HTTP ${created.status})`, results };
      await sleep(300);
    }
    const again = await call("GET", "/wish_list_names.json");
    names = normNames(again.data);
    for (const name of wanted) {
      if (!names.some((n) => n.name === name && n.code)) return { error: `리스트 "${name}" 코드를 찾지 못함`, results };
    }
  }
  const codeOf = (name) => names.find((n) => n.name === name)?.code;
  const managedCodes = new Set((plan.managedNames || []).map(codeOf).filter(Boolean));

  for (const item of plan.items) {
    try {
      if (item.action === "remove") {
        const r = await call("DELETE", `/items/${item.id}/wish_list`);
        results.push({ id: item.id, ok: r.ok || r.status === 404, status: r.status });
      } else if (item.action === "list") {
        const target = codeOf(item.listName);
        const current = await call("GET", `/items/${item.id}/wish_list_items.json`);
        const entries = Array.isArray(current.data) ? current.data : [];
        const inLists = entries
          .filter((e) => pick(e, "isItemInWishListName", "is_item_in_wish_list_name"))
          .map((e) => String(pick(e, "wishListNameCode", "wish_list_name_code", "code")));
        const next = [...new Set([...inLists.filter((c) => !managedCodes.has(c)), target])];
        const r = await call("PATCH", `/items/${item.id}/wish_list_items.json`, { wish_list_name_codes: next, wishListNameCodes: next });
        results.push({ id: item.id, ok: r.ok, status: r.status });
      }
    } catch (e) {
      results.push({ id: item.id, ok: false, status: String(e) });
    }
    await sleep(350);
  }
  return { results };
}
