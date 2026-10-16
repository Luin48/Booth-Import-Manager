import { localApi, ping } from "./lib/local.js";
import { classifyPurchase, pageApplyWishlist, pageCollectLibrary, pageFetchItems, slimItem } from "./lib/booth.js";

// 아이콘 클릭 → 사이드패널
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

const isBoothUrl = (value) => typeof value === "string" && /(^|\/\/|\.)booth\.pm\//.test(value.replace(/^https?:\/\//, "//"));
const downloadableIdOf = (url) => (String(url || "").match(/downloadables\/(\d+)/) || [])[1] || "";

// ---- 다운로드 의도 저장 (서비스워커가 재시작돼도 유지되도록 session storage) ----
async function setIntent(downloadId, intent) {
  await chrome.storage.session.set({ [`intent:${downloadId}`]: intent });
}
async function takeIntent(downloadId) {
  const key = `intent:${downloadId}`;
  const data = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return data[key] || null;
}
// 부스 기본 Download 버튼을 눌렀을 때 상품 정보만 기억해 둔다 (태그 없이 보관 폴더로)
async function noteClick(downloadableId, booth) {
  if (!downloadableId) return;
  await chrome.storage.session.set({ [`click:${downloadableId}`]: { booth, at: Date.now() } });
}
async function takeClick(downloadableId) {
  if (!downloadableId) return null;
  const key = `click:${downloadableId}`;
  const data = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  const entry = data[key];
  return entry && Date.now() - entry.at < 10 * 60 * 1000 ? entry : null;
}

chrome.downloads.onCreated.addListener(async (item) => {
  if (!isBoothUrl(item.url) && !isBoothUrl(item.referrer)) return;
  const existing = await chrome.storage.session.get(`intent:${item.id}`);
  if (existing[`intent:${item.id}`]) return;
  const click = await takeClick(downloadableIdOf(item.url));
  if (click) await setIntent(item.id, { tag: "", autoQueue: false, booth: click.booth });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  if (delta.state.current === "interrupted") {
    takeIntent(delta.id).then((intent) => intent && broadcast({ type: "download-failed", booth: intent.booth }));
    return;
  }
  if (delta.state.current !== "complete") return;
  chrome.downloads.search({ id: delta.id }, async (items) => {
    const item = items && items[0];
    if (!item || !item.filename) return;
    if (![item.url, item.finalUrl, item.referrer].some(isBoothUrl)) return;
    const intent = (await takeIntent(item.id)) || {};
    const filename = item.filename.split(/[\\/]/).pop();
    try {
      const result = await localApi("/api/download-complete", {
        method: "POST",
        timeoutMs: 120000,
        body: {
          filename,
          fullPath: item.filename,
          sourceUrl: item.url || "",
          finalUrl: item.finalUrl || "",
          referrer: item.referrer || "",
          tag: intent.tag || "",
          project: intent.project || "",
          autoQueue: Boolean(intent.autoQueue),
          booth: { ...(intent.booth || {}), downloadableId: intent.booth?.downloadableId || downloadableIdOf(item.url) },
        },
      });
      broadcast({ type: "download-done", result, booth: intent.booth });
      setBadge(result.status === "queued" ? "✓" : "");
    } catch (error) {
      broadcast({ type: "download-error", error: error.message, booth: intent.booth });
      setBadge("!");
    }
  });
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

async function handle(msg, sender) {
  switch (msg.type) {
    case "ping":
      return ping();
    case "bootstrap": {
      // 콘텐츠 스크립트용: 태그 + 프로젝트 + 마지막 선택값
      const [config, projectList, prefs] = await Promise.all([
        localApi("/api/config"),
        localApi("/api/projects?all=0&deep=0"),
        chrome.storage.local.get(["lastProject", "lastTagByProject"]),
      ]);
      const boot = { config, projects: projectList, lastProject: prefs.lastProject || "", lastTagByProject: prefs.lastTagByProject || {} };
      // 다음 페이지에서 바로 그릴 수 있게 캐시 (콘텐츠 스크립트가 먼저 이걸로 그리고, 응답이 오면 갱신)
      chrome.storage.local.set({ bootCache: { config, projects: projectList, at: Date.now() } }).catch(() => {});
      return boot;
    }
    case "projectsLive":
      // 실행 중/꺼짐 실시간 표시용 (가벼운 조회)
      return localApi("/api/projects?all=0&deep=0");
    case "rememberChoice": {
      const prefs = await chrome.storage.local.get("lastTagByProject");
      const map = prefs.lastTagByProject || {};
      if (msg.project) map[msg.project] = msg.tag || "";
      await chrome.storage.local.set({ lastProject: msg.project || "", lastTagByProject: map });
      return true;
    }
    case "status":
      return localApi("/api/booth/status", { method: "POST", body: { itemIds: msg.itemIds || [], downloadableIds: msg.downloadableIds || [] } });
    case "noteClick":
      await noteClick(msg.downloadableId, msg.booth);
      return true;
    case "unity": {
      // 이미 받아둔 파일이면 재다운로드 없이 큐로
      if (msg.preferLocal && msg.booth?.downloadableId) {
        try {
          const res = await localApi("/api/booth/requeue", { method: "POST", body: { downloadableId: msg.booth.downloadableId, tag: msg.tag, project: msg.project || "" } });
          broadcast({ type: "download-done", result: { ...res, status: res.status || "queued" }, booth: msg.booth });
          return { mode: "requeue", result: res };
        } catch {
          /* 로컬에 없으면 아래에서 새로 받기 */
        }
      }
      const alive = await ping();
      if (!alive.ok) throw new Error("로컬 앱이 꺼져 있어요. BoothImportManager.exe를 먼저 실행해 주세요.");
      const downloadId = await chrome.downloads.download({ url: msg.url, conflictAction: "uniquify", saveAs: false });
      await setIntent(downloadId, { tag: msg.tag || "", project: msg.project || "", autoQueue: msg.autoQueue !== false, booth: msg.booth || {} });
      return { mode: "download", downloadId };
    }
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
      if (sender.tab?.windowId) await chrome.sidePanel.open({ windowId: sender.tab.windowId });
      return true;
    default:
      throw new Error(`unknown message ${msg.type}`);
  }
}

// 업데이트 때 예전 버전의 다크 테마 CSS 캐시 정리
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith("darkcss:") && !k.startsWith("darkcss:v2"));
    if (stale.length) await chrome.storage.local.remove(stale);
  } catch {
    /* ignore */
  }
});
