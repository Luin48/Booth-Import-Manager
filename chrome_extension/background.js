import * as core from "./lib/core.js";
import { classifyPurchase, pageApplyWishlist, pageCollectLibrary, pageFetchItems, slimItem } from "./lib/booth.js";

// ---- 사이드패널: 부스 페이지에서만 ---------------------------------------------
const isBoothTab = (url) => /^https:\/\/([\w-]+\.)?booth\.pm(\/|$)/.test(url || "");

function syncPanel(tabId, url) {
  const options = isBoothTab(url) ? { tabId, path: "sidepanel.html", enabled: true } : { tabId, enabled: false };
  return chrome.sidePanel.setOptions(options).catch(() => {});
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {}); // 기본은 꺼 두고 부스 탭만 켠다
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "loading") syncPanel(tabId, tab.url);
});
async function syncAllTabs() {
  for (const tab of await chrome.tabs.query({})) await syncPanel(tab.id, tab.url);
}
chrome.runtime.onStartup.addListener(() => syncAllTabs().catch(() => {}));

// 아이콘: 부스 페이지면 사이드패널, 아니면 관리 페이지
chrome.action.onClicked.addListener((tab) => {
  if (isBoothTab(tab.url)) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") });
  }
});

// ---- 다운로드 → 대기열 (lib/core.js) -------------------------------------------
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => core.onDeterminingFilename(item, suggest));
chrome.downloads.onChanged.addListener((delta) => {
  core.onDownloadChanged(delta, (msg) => {
    broadcast(msg);
    if (msg.type === "download-done") setBadge(msg.result?.status === "queued" ? "✓" : "!");
  }).catch((error) => broadcast({ type: "download-error", error: error.message }));
});

function setBadge(text) {
  chrome.action.setBadgeBackgroundColor({ color: text === "!" ? "#d98a5f" : "#4fb7df" }).catch(() => {});
  chrome.action.setBadgeText({ text }).catch(() => {});
  if (text) setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), 6000);
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  chrome.tabs.query({ url: ["https://*.booth.pm/*", "https://booth.pm/*"] }, (tabs) => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  });
}

// ---- 탭 안에서 함수 실행 (같은 출처로 부스 API 호출) ------------------------
async function withBoothTab(origin, openPath, func, args) {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  let tab = tabs.find((t) => t.status === "complete") || null;
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: `${origin}${openPath}`, active: false });
    created = true;
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(resolve, 20000);
    });
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    return res?.result;
  } finally {
    if (created) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ---- 찜목록 정리 ---------------------------------------------------------
async function wishlistScan(progress) {
  progress("구매한 상품 목록 읽는 중 (라이브러리)…");
  const library = await withBoothTab("https://accounts.booth.pm", "/library", pageCollectLibrary, [60]);
  if (!Array.isArray(library)) throw new Error("라이브러리를 읽지 못했어요. BOOTH에 로그인되어 있는지 확인해 주세요.");
  progress(`구매 상품 ${library.length}개 — 상품 정보 확인 중…`);
  const ids = library.map((i) => i.id);
  const details = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = await withBoothTab("https://booth.pm", "/", pageFetchItems, [ids.slice(i, i + 25)]);
    details.push(...(chunk || []));
    progress(`상품 정보 ${Math.min(i + 25, ids.length)} / ${ids.length}`);
  }
  const byId = new Map(details.map((d) => [d.id, d]));
  const items = library.map((lib) => {
    const d = byId.get(lib.id) || { id: lib.id, error: "no data" };
    const cls = d.error ? { category: "none", boughtNames: [], paidCount: 0 } : classifyPurchase(d);
    return {
      id: lib.id,
      name: d.name || lib.name,
      thumbnail: d.thumbnail || lib.thumbnail,
      wished: Boolean(d.wished),
      error: d.error || "",
      category: cls.category === "none" ? "single" : cls.category, // 라이브러리에 있으면 최소 '구매'
      boughtNames: cls.boughtNames,
      paidCount: cls.paidCount,
    };
  });
  await chrome.storage.local.set({ lastWishlistScan: { at: Date.now(), items } });
  return items;
}

async function wishlistApply(plan) {
  return withBoothTab("https://accounts.booth.pm", "/wish_lists", pageApplyWishlist, [plan]);
}

// ---- 메시지 ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function bootData() {
  const [config, projects, prefs] = await Promise.all([
    core.getConfig(),
    core.listProjects({ includeHidden: false }),
    chrome.storage.local.get(["lastProject", "lastTagByProject"]),
  ]);
  const data = { config: { tags: config.tags, tagSets: config.tagSets }, projects };
  chrome.storage.local.set({ bootCache: { ...data, at: Date.now() } }).catch(() => {});
  return { ...data, lastProject: prefs.lastProject || "", lastTagByProject: prefs.lastTagByProject || {} };
}

async function handle(msg, sender) {
  switch (msg.type) {
    case "api":
      return core.route(msg.path, msg.method || "GET", msg.body || {});
    case "ping":
      return core.route("/ping");
    case "bootstrap":
      // 설정·프로젝트는 크롬 저장소에 있어서 바로 응답. 실행 상태는 뒤에서 확인.
      core.liveUnities().catch(() => {});
      return bootData();
    case "projectsLive":
      await core.liveUnities();
      return core.listProjects({ includeHidden: false });
    case "rememberChoice": {
      const prefs = await chrome.storage.local.get("lastTagByProject");
      const map = prefs.lastTagByProject || {};
      if (msg.project) map[msg.project] = msg.tag || "";
      await chrome.storage.local.set({ lastProject: msg.project || "", lastTagByProject: map });
      return true;
    }
    case "status":
      return core.boothStatus({ itemIds: msg.itemIds || [], downloadableIds: msg.downloadableIds || [] });
    case "noteClick":
      return true; // v0.4: 부스 기본 Download 버튼은 그냥 크롬 다운로드
    case "unity":
      return core.startJob({ url: msg.url, project: msg.project, tag: msg.tag, booth: msg.booth || {}, preferLocal: Boolean(msg.preferLocal) }, broadcast);
    case "itemJson": {
      // 콘텐츠 스크립트가 다른 출처(상점 서브도메인)일 때 대신 조회
      const res = await fetch(`https://booth.pm/ja/items/${msg.id}.json`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const item = slimItem(await res.json());
      return { item, purchase: classifyPurchase(item) };
    }
    case "wishlistScan":
      return wishlistScan((text) => chrome.runtime.sendMessage({ type: "wishlist-progress", text }).catch(() => {}));
    case "wishlistApply":
      return wishlistApply(msg.plan);
    case "openManage":
      await chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") + (msg.hash || "") });
      return true;
    case "openPanel":
      if (sender.tab?.id) await chrome.sidePanel.open({ tabId: sender.tab.id });
      return true;
    default:
      throw new Error(`unknown message ${msg.type}`);
  }
}

// 업데이트 때 예전 버전의 다크 테마 CSS 캐시 정리
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith("darkcss:") && !k.startsWith("darkcss:v3"));
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch {
    /* ignore */
  }
  syncAllTabs().catch(() => {});
});
