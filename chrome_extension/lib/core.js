// v0.4 — exe 없이 동작하는 핵심 로직 (서비스워커에서만 실행)
//
//  크롬 확장 ── 다운로드 폴더 ──▶ 유니티 패키지
//   · [Unity로] → 부스 파일을 다운로드\BoothImportManager\대기열\<프로젝트 키>\<작업 id>\ 에 바로 저장
//   · 다운로드가 끝나면 같은 폴더에 job.json(태그·상품 정보)을 저장
//   · 유니티가 켜져 있으면 바로, 꺼져 있으면 다음에 켤 때 job.json 을 보고 임포트
//   · 켜진 유니티는 127.0.0.1:7840~7849 에서 응답 → 실행 상태, 프로젝트 목록, 설치, 결과 조회
//
// 설정·태그·작업 기록은 chrome.storage.local 에 보관한다.

export const QUEUE_FOLDER = "BoothImportManager";
export const QUEUE_SUB = "대기열";
export const UNTAGGED = "태그 없음";
export const VPM_INDEX = "https://raw.githubusercontent.com/Luin48/Booth-Import-Manager/main/vpm/index.json";
const PORTS = Array.from({ length: 10 }, (_, i) => 7840 + i);
const CFG_KEY = "bimConfig";
const PROJ_KEY = "bimProjects";
const JOBS_KEY = "bimJobs";
const ACTIVE = new Set(["downloading", "queued", "importing"]);

const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
const now = () => Date.now() / 1000;
const sep = (p) => (String(p).includes("\\") ? "\\" : "/");

// ---- 설정 ---------------------------------------------------------------------
const DEFAULT_CONFIG = () => ({
  tags: [{ id: "untagged", name: UNTAGGED }],
  tagSets: [],
  projectRoots: [],
  extraProjects: [],
  projectSettings: {}, // key -> { tags: null|[id], assetRoot, hidden, alias }
  archiveDir: "", // 비우면 다운로드\BoothImportManager\보관
  keepArchive: true,
  downloadsDir: "", // 첫 다운로드 때 알아냄
});

export async function getConfig() {
  const data = await chrome.storage.local.get(CFG_KEY);
  const cfg = { ...DEFAULT_CONFIG(), ...(data[CFG_KEY] || {}) };
  if (!cfg.tags.some((t) => t.name === UNTAGGED)) cfg.tags.unshift({ id: "untagged", name: UNTAGGED });
  return cfg;
}

export async function saveConfig(patch) {
  const cfg = { ...(await getConfig()), ...patch };
  // 지워진 태그는 프로젝트 할당·세트에서도 뺀다
  const valid = new Set(cfg.tags.map((t) => t.id));
  for (const s of Object.values(cfg.projectSettings)) if (Array.isArray(s.tags)) s.tags = s.tags.filter((id) => valid.has(id));
  cfg.tagSets = (cfg.tagSets || []).map((s) => ({ ...s, tags: (s.tags || []).filter((id) => valid.has(id)) }));
  await chrome.storage.local.set({ [CFG_KEY]: cfg, configVersion: Date.now() });
  return cfg;
}

export function queueRootFor(cfg) {
  return cfg.downloadsDir ? `${cfg.downloadsDir}${sep(cfg.downloadsDir)}${QUEUE_FOLDER}` : "";
}

// ---- 유니티 찾기 (켜진 프로젝트마다 7840~7849 중 하나) -------------------------------
let liveCache = { at: 0, list: [] };
let livePromise = null;

async function fetchJson(url, { method = "GET", body, timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("유니티 응답 시간 초과 (임포트·컴파일 중일 수 있어요)");
    if (error instanceof TypeError) throw new Error("유니티에 연결할 수 없어요");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 켜진 유니티 목록 [{port, key, name, path, version, queueRoot, ...}] */
export async function liveUnities({ maxAgeMs = 2500 } = {}) {
  if (Date.now() - liveCache.at < maxAgeMs) return liveCache.list;
  if (!livePromise) {
    livePromise = Promise.all(
      PORTS.map((port) =>
        fetchJson(`http://127.0.0.1:${port}/bim/ping`, { timeoutMs: 900 })
          .then((info) => (info && info.app === "bim-unity" ? { ...info, port } : null))
          .catch(() => null),
      ),
    )
      .then((rows) => {
        const prev = new Map(liveCache.list.map((u) => [u.key, u]));
        const list = rows.filter(Boolean);
        // 컴파일 중에는 몇 초 응답이 없으니 15초까지는 '켜짐'으로 유지
        for (const [key, u] of prev) {
          if (!list.some((x) => x.key === key) && Date.now() - (u.seenAt || 0) < 15000) list.push({ ...u, stale: true });
        }
        for (const u of list) if (!u.stale) u.seenAt = Date.now();
        liveCache = { at: Date.now(), list };
        onLive(list).catch(() => {});
        return list;
      })
      .finally(() => {
        livePromise = null;
      });
  }
  return livePromise;
}

export async function anyUnity() {
  const list = await liveUnities();
  return list.find((u) => !u.stale) || null;
}

export async function unityApi(path, body, { unity, timeoutMs = 8000 } = {}) {
  const u = unity || (await anyUnity());
  if (!u) throw new Error("켜진 유니티가 없어요 (BIM 패키지가 설치된 프로젝트를 하나 켜 주세요)");
  return fetchJson(`http://127.0.0.1:${u.port}${path}`, { method: body === undefined ? "GET" : "POST", body, timeoutMs });
}

// 유니티가 보이면: 폴더 설정을 맞추고, 오래된 프로젝트 목록이면 다시 훑는다
let lastConfigPush = 0;
async function onLive(list) {
  const alive = list.filter((u) => !u.stale);
  if (!alive.length) return;
  const cfg = await getConfig();
  const wantRoot = queueRootFor(cfg);
  const u = alive[0];
  const needPush =
    (wantRoot && u.queueRoot !== wantRoot) || (cfg.archiveDir && u.archiveDir !== cfg.archiveDir) || u.keepArchive !== cfg.keepArchive;
  if (needPush && Date.now() - lastConfigPush > 5000) {
    lastConfigPush = Date.now();
    await pushUnityConfig(cfg, u).catch(() => {});
  }
  const proj = await chrome.storage.local.get(PROJ_KEY);
  if (Date.now() - (proj[PROJ_KEY]?.at || 0) > 5 * 60 * 1000) scanProjects().catch(() => {});
  for (const unity of alive) syncInstalled(unity).catch(() => {});
}

// ---- 프로젝트에 이미 들어 있는 상품 (썸네일 아이콘이 붙은 폴더) → 라이브러리 '임포트됨' 표시 ----------
// 썸네일 매칭으로 아이콘을 붙인 상품도 BOOTH 라이브러리에 그 프로젝트 '임포트됨'으로 보이게,
// 유니티(BIM 1.1.0+)의 /bim/installed 를 읽어 숨김 작업 기록(source: "installed")으로 저장한다.
// 작업 기록에 넣어 두므로 v1.1.0 확장으로 돌아가도 표시가 남는다.
const installedSeen = new Map(); // project key -> { stamp, at }

export async function syncInstalled(unity, { force = false } = {}) {
  if (!unity?.key || !unity.iconStamp) return null; // 1.1.0 미만 유니티 패키지
  const prev = installedSeen.get(unity.key);
  if (!force && prev && prev.stamp === unity.iconStamp && Date.now() - prev.at < 10 * 60 * 1000) return null;
  installedSeen.set(unity.key, { stamp: unity.iconStamp, at: Date.now() });
  const res = await unityApi("/bim/installed", {}, { unity, timeoutMs: 20000 });
  const items = new Map();
  for (const it of res?.items || []) if (it.itemId && !items.has(it.itemId)) items.set(it.itemId, it);
  const projects = (await chrome.storage.local.get(PROJ_KEY))[PROJ_KEY]?.list || [];
  const name = projects.find((p) => p.key === unity.key)?.name || unity.name || unity.key;
  return updateJobs((all) => {
    let added = 0;
    let removed = 0;
    const has = new Set();
    for (const j of Object.values(all)) {
      if (j.project !== unity.key || !j.itemId) continue;
      if (j.source === "installed") {
        if (!items.has(j.itemId)) {
          delete all[j.jobId];
          removed++;
        } else has.add(j.itemId);
      } else if (j.state === "imported") has.add(j.itemId); // BIM 으로 임포트한 기록이 이미 있음
    }
    for (const [itemId, it] of items) {
      if (has.has(itemId)) continue;
      const jobId = `inst_${String(unity.key).replace(/[^\w-]/g, "_").slice(0, 40)}_${itemId}`;
      all[jobId] = {
        jobId,
        source: "installed",
        hidden: true,
        project: unity.key,
        projectName: name,
        tag: "",
        itemId,
        itemName: it.title || "",
        downloadableId: "",
        filename: "",
        folder: it.folder || "",
        state: "imported",
        createdAt: now(),
        updatedAt: now(),
      };
      added++;
    }
    return { added, removed, total: items.size };
  });
}

export async function pushUnityConfig(cfg, unity) {
  const wantRoot = queueRootFor(cfg);
  return unityApi(
    "/bim/config",
    {
      setQueueRoot: Boolean(wantRoot),
      queueRoot: wantRoot,
      setArchiveDir: true,
      archiveDir: cfg.archiveDir || "",
      setKeepArchive: true,
      keepArchive: cfg.keepArchive !== false,
    },
    { unity },
  );
}

// ---- 프로젝트 -------------------------------------------------------------------
export async function scanProjects() {
  const cfg = await getConfig();
  const res = await unityApi("/bim/scan", { roots: cfg.projectRoots || [], extra: cfg.extraProjects || [] }, { timeoutMs: 30000 });
  const list = res.projects || [];
  await chrome.storage.local.set({ [PROJ_KEY]: { at: Date.now(), list } });
  return list;
}

function pendingCounts(jobs) {
  const counts = {};
  for (const j of Object.values(jobs)) {
    if (!j.project || j.hidden) continue;
    const c = (counts[j.project] ||= { pending: 0, failed: 0 });
    if (ACTIVE.has(j.state)) c.pending += 1;
    if (j.state === "failed") c.failed += 1;
  }
  return counts;
}

/** 관리 페이지·선택기에서 쓰는 프로젝트 목록 (예전 /api/projects 와 같은 모양) */
export async function listProjects({ includeHidden = true, live } = {}) {
  const [cfg, stored, jobs] = await Promise.all([getConfig(), chrome.storage.local.get(PROJ_KEY), getJobs()]);
  const list = [...(stored[PROJ_KEY]?.list || [])];
  const units = live || liveCache.list;
  for (const u of units) {
    if (!list.some((p) => p.key === u.key)) list.push({ key: u.key, name: u.name, path: u.path, unityVersion: u.unityVersion, installed: "packages", installedVersion: u.version });
  }
  const latest = units.map((u) => u.version).filter(Boolean).sort(cmpVersion).pop() || "";
  const counts = pendingCounts(jobs);
  return list
    .map((p) => {
      const s = cfg.projectSettings[p.key] || {};
      const u = units.find((x) => x.key === p.key);
      return {
        key: p.key,
        folderName: p.name,
        name: s.alias || p.name,
        path: p.path,
        unityVersion: p.unityVersion || "",
        tags: Array.isArray(s.tags) ? s.tags : null,
        assetRoot: s.assetRoot || "Assets",
        hidden: Boolean(s.hidden),
        running: Boolean(u),
        openWithoutPackage: !u && Boolean(p.open),
        missing: Boolean(p.missing),
        installed: u ? "packages" : p.installed || "",
        installedVersion: u ? u.version : p.installedVersion || "",
        packageVersion: u ? u.version : "",
        latestVersion: latest,
        pending: counts[p.key]?.pending || 0,
        failed: counts[p.key]?.failed || 0,
      };
    })
    .filter((p) => includeHidden || !p.hidden)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

export async function saveProjectSettings(updates) {
  const cfg = await getConfig();
  for (const u of updates || []) {
    if (!u.key) continue;
    const s = { ...(cfg.projectSettings[u.key] || {}) };
    if ("tags" in u) s.tags = Array.isArray(u.tags) ? u.tags : null;
    if ("hidden" in u) s.hidden = Boolean(u.hidden);
    if ("alias" in u) s.alias = String(u.alias || "").trim();
    if ("assetRoot" in u) s.assetRoot = String(u.assetRoot || "Assets").replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "") || "Assets";
    cfg.projectSettings[u.key] = s;
  }
  await saveConfig({ projectSettings: cfg.projectSettings });
  return true;
}

// ---- 작업 기록 -------------------------------------------------------------------
export async function getJobs() {
  return (await chrome.storage.local.get(JOBS_KEY))[JOBS_KEY] || {};
}

// 서비스워커 안에서 동시에 고쳐 써도 안 꼬이게 순서대로 처리
let jobsChain = Promise.resolve();
export function updateJobs(mutator) {
  const run = jobsChain.then(async () => {
    const jobs = await getJobs();
    const result = await mutator(jobs);
    // 기록이 너무 많아지면 오래된 완료 기록부터 정리 (최대 500개)
    // (설치 확인 기록 source=installed 는 유니티가 다시 알려주니 정리 대상에서 뺀다)
    const ids = Object.keys(jobs).filter((id) => jobs[id].source !== "installed");
    if (ids.length > 500) {
      ids
        .filter((id) => !ACTIVE.has(jobs[id].state))
        .sort((a, b) => (jobs[a].updatedAt || 0) - (jobs[b].updatedAt || 0))
        .slice(0, ids.length - 500)
        .forEach((id) => delete jobs[id]);
    }
    await chrome.storage.local.set({ [JOBS_KEY]: jobs });
    return result;
  });
  jobsChain = run.catch(() => {});
  return run;
}

function projectName(projects, key) {
  return projects.find((p) => p.key === key)?.name || key;
}

// ---- 다운로드 → 대기열 ----------------------------------------------------------------
function safeSegment(name, fallback = "_") {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1f~]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function jobFolder(job) {
  return `${QUEUE_FOLDER}/${QUEUE_SUB}/${safeSegment(job.project)}/${job.jobId}`;
}

async function enrichThumbs(job) {
  if (!job.itemId) return {};
  try {
    const res = await fetch(`https://booth.pm/ja/items/${job.itemId}.json`, { credentials: "include" });
    if (!res.ok) return {};
    const d = await res.json();
    const img = (d.images || [])[0] || {};
    return {
      itemName: job.itemName || d.name || "",
      itemUrl: d.url || `https://booth.pm/ja/items/${job.itemId}`,
      shopName: job.shopName || d.shop?.name || "",
      shopUrl: job.shopUrl || d.shop?.url || "",
      itemThumbUrl: String(img.resized || img.original || "").replace("/c/72x72_a2_g5/", "/c/300x300_a2_g5/"),
      shopIconUrl: String(d.shop?.thumbnail_url || "").replace("/c/48x48/", "/c/128x128/"),
    };
  } catch {
    return {};
  }
}

/** [Unity로] / [받기] 버튼 */
export async function startJob({ url, project, tag, booth = {}, preferLocal = false }, notify) {
  if (!url) throw new Error("다운로드 주소가 없어요");
  if (!project) throw new Error("프로젝트를 고르세요");
  const cfg = await getConfig();
  const projects = await listProjects();
  const job = {
    jobId: uid(),
    project,
    projectName: projectName(projects, project),
    tag: tag || UNTAGGED,
    assetRoot: (cfg.projectSettings[project] || {}).assetRoot || "Assets",
    url,
    downloadableId: booth.downloadableId || (String(url).match(/downloadables\/(\d+)/) || [])[1] || "",
    itemId: booth.itemId || "",
    itemName: booth.itemName || "",
    itemUrl: booth.itemId ? `https://booth.pm/ja/items/${booth.itemId}` : "",
    shopName: booth.shopName || "",
    shopUrl: booth.shopUrl || "",
    thumbnail: booth.thumbnail || "",
    fileLabel: booth.fileLabel || "",
    filename: "",
    state: "downloading",
    createdAt: now(),
    updatedAt: now(),
  };

  // 이미 받아서 보관 폴더에 있는 파일이면 다시 받지 않고 유니티에게 복사를 맡긴다
  if (preferLocal && job.downloadableId) {
    const jobs = await getJobs();
    const prev = Object.values(jobs)
      .filter((j) => j.downloadableId === job.downloadableId && j.archivedPath)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const unity = prev && (await anyUnity());
    if (prev && unity) {
      try {
        const enriched = { ...job, ...(await enrichThumbs(job)), filename: prev.filename, state: "queued" };
        await unityApi("/bim/requeue", { archivedPath: prev.archivedPath, job: jobJson(enriched) }, { unity });
        await updateJobs((all) => {
          all[job.jobId] = enriched;
        });
        notify?.({ type: "download-done", result: { status: "queued", projectName: job.projectName, running: await isRunning(project), requeue: true }, booth });
        return { mode: "requeue", jobId: job.jobId };
      } catch {
        /* 실패하면 새로 받기 */
      }
    }
  }

  await chrome.storage.session.set({ [`dlurl:${url}`]: job.jobId });
  await updateJobs((all) => {
    all[job.jobId] = job;
  });
  enrichThumbs(job).then((extra) =>
    updateJobs((all) => {
      if (all[job.jobId]) Object.assign(all[job.jobId], extra);
    }),
  );
  let downloadId;
  try {
    downloadId = await chrome.downloads.download({ url, conflictAction: "uniquify", saveAs: false });
  } catch (error) {
    await updateJobs((all) => {
      if (all[job.jobId]) Object.assign(all[job.jobId], { state: "failed", error: error.message, updatedAt: now() });
    });
    throw error;
  }
  await chrome.storage.session.set({ [`dlid:${downloadId}`]: job.jobId });
  await updateJobs((all) => {
    if (all[job.jobId]) all[job.jobId].downloadId = downloadId;
  });
  return { mode: "download", downloadId, jobId: job.jobId };
}

async function isRunning(key) {
  const list = await liveUnities();
  return list.some((u) => u.key === key && !u.stale);
}

function jobJson(job) {
  const keys = ["jobId", "project", "tag", "assetRoot", "filename", "downloadableId", "itemId", "itemName", "itemUrl", "shopName", "shopUrl", "itemThumbUrl", "shopIconUrl", "fileLabel", "createdAt"];
  return Object.fromEntries(keys.map((k) => [k, job[k] ?? ""]));
}

function toDataUrl(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:application/json;base64,${btoa(bin)}`;
}

// job.json 저장 위치 (data: 주소 → 대기열 경로). onDeterminingFilename 리스너가 있으면
// download() 에 준 filename 을 크롬이 무시하므로 여기서 다시 알려준다.
const jsonTargets = new Map();

/** 크롬이 저장 위치를 정할 때: 우리 작업이면 대기열 폴더로 */
export function onDeterminingFilename(item, suggest) {
  if (String(item.url || "").startsWith("data:")) {
    const target = jsonTargets.get(item.url);
    if (target) {
      jsonTargets.delete(item.url);
      suggest({ filename: target, conflictAction: "overwrite" });
    } else suggest();
    return false;
  }
  const key = `dlurl:${item.url}`;
  chrome.storage.session
    .get([key, `dlid:${item.id}`])
    .then(async (data) => {
      const jobId = data[`dlid:${item.id}`] || data[key];
      if (!jobId) return suggest();
      const jobs = await getJobs();
      const job = jobs[jobId];
      if (!job || job.state !== "downloading") return suggest();
      await chrome.storage.session.remove(key);
      await chrome.storage.session.set({ [`dlid:${item.id}`]: jobId });
      const base = safeSegment(String(item.filename || "").split(/[\\/]/).pop(), "booth_download");
      suggest({ filename: `${jobFolder(job)}/${base}`, conflictAction: "uniquify" });
    })
    .catch(() => suggest());
  return true;
}

/** 다운로드가 끝나거나 실패했을 때 */
export async function onDownloadChanged(delta, notify) {
  if (!delta.state) return;
  const ids = await chrome.storage.session.get([`dlid:${delta.id}`, `json:${delta.id}`]);
  const jsonJob = ids[`json:${delta.id}`];
  if (jsonJob) {
    // job.json 저장 완료 → 다운로드 목록에서만 지운다 (파일은 남음)
    if (delta.state.current === "complete") chrome.downloads.erase({ id: delta.id }).catch(() => {});
    if (delta.state.current !== "in_progress") await chrome.storage.session.remove(`json:${delta.id}`);
    return;
  }
  const jobId = ids[`dlid:${delta.id}`];
  if (!jobId) return;
  if (delta.state.current === "interrupted") {
    await chrome.storage.session.remove(`dlid:${delta.id}`);
    const job = await updateJobs((all) => {
      const j = all[jobId];
      if (j && j.state === "downloading") Object.assign(j, { state: j.cancelRequested ? "cancelled" : "failed", error: "다운로드가 중단됐어요", updatedAt: now() });
      return j;
    });
    if (job && job.state === "failed") notify?.({ type: "download-failed", error: `다운로드 실패: ${job.fileLabel || job.itemName || ""}`, booth: { downloadableId: job.downloadableId } });
    return;
  }
  if (delta.state.current !== "complete") return;
  await chrome.storage.session.remove(`dlid:${delta.id}`);
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item?.filename) return;
  const full = item.filename;
  const filename = full.split(/[\\/]/).pop();

  // 다운로드 폴더 위치 알아두기 (…\BoothImportManager\대기열\키\작업\파일)
  const marker = `${sep(full)}${QUEUE_FOLDER}${sep(full)}${QUEUE_SUB}${sep(full)}`;
  const idx = full.indexOf(marker);
  let cfg = await getConfig();
  if (idx > 0) {
    const dir = full.slice(0, idx);
    if (dir !== cfg.downloadsDir) {
      cfg = await saveConfig({ downloadsDir: dir });
      const unity = await anyUnity();
      if (unity) pushUnityConfig(cfg, unity).catch(() => {});
    }
  }

  const job = await updateJobs((all) => {
    const j = all[jobId];
    if (!j) return null;
    Object.assign(j, { filename, path: full, state: "queued", updatedAt: now() });
    return { ...j };
  });
  if (!job) return;
  if (idx < 0) {
    // 다른 확장이 위치를 바꿨거나 '다운로드 전 위치 묻기'로 다른 곳에 저장됨
    await updateJobs((all) => {
      if (all[jobId]) Object.assign(all[jobId], { state: "failed", error: "대기열 폴더가 아닌 곳에 저장됐어요 (크롬 '다운로드 전에 위치 확인' 설정을 꺼 주세요)" });
    });
    notify?.({ type: "download-done", result: { status: "failed", queueError: "대기열 폴더가 아닌 곳에 저장됐어요", filename } });
    return;
  }
  const dataUrl = toDataUrl(JSON.stringify(jobJson(job), null, 2));
  jsonTargets.set(dataUrl, `${jobFolder(job)}/job.json`);
  const jsonId = await chrome.downloads.download({
    url: dataUrl,
    filename: `${jobFolder(job)}/job.json`,
    conflictAction: "overwrite",
    saveAs: false,
  });
  await chrome.storage.session.set({ [`json:${jsonId}`]: jobId });
  await updateJobs((all) => {
    if (all[jobId]) all[jobId].jsonDownloadId = jsonId;
  });
  const running = await isRunning(job.project);
  if (running) unityApi("/bim/scan-queue", {}, { unity: (await liveUnities()).find((u) => u.key === job.project) }).catch(() => {});
  notify?.({ type: "download-done", result: { status: "queued", projectName: job.projectName, running, filename }, booth: { downloadableId: job.downloadableId } });
}

/** 유니티에게 진행 상황 묻기 */
let lastRefresh = 0;
export async function refreshJobs({ force = false } = {}) {
  if (!force && Date.now() - lastRefresh < 3000) return;
  lastRefresh = Date.now();
  const jobs = await getJobs();
  const active = Object.values(jobs).filter((j) => (j.state === "queued" || j.state === "importing") && j.filename);
  if (!active.length) return;
  const unity = await anyUnity();
  if (!unity) return;
  let res;
  try {
    res = await unityApi("/bim/jobs", { jobs: active.map((j) => ({ jobId: j.jobId, project: j.project })) }, { unity });
  } catch {
    return;
  }
  await updateJobs((all) => {
    for (const r of res.items || []) {
      const j = all[r.jobId];
      if (!j || !r.state || r.state === "unknown") continue;
      if (r.state === j.state) continue;
      Object.assign(j, {
        state: r.state,
        error: r.error || "",
        archivedPath: r.archivedPath || j.archivedPath || "",
        importedTo: r.importedTo || j.importedTo || [],
        updatedAt: now(),
      });
    }
  });
}

export async function cancelJob(jobId) {
  const job = (await getJobs())[jobId];
  if (!job) return "gone";
  if (job.state === "downloading" && job.downloadId) {
    await updateJobs((all) => {
      if (all[jobId]) all[jobId].cancelRequested = true;
    });
    await chrome.downloads.cancel(job.downloadId).catch(() => {});
  } else if (job.state === "queued") {
    let done = false;
    const unity = await anyUnity();
    if (unity) {
      try {
        await unityApi("/bim/cancel", { jobId, project: job.project }, { unity });
        done = true;
      } catch (error) {
        if (/임포트 중/.test(error.message)) throw error;
      }
    }
    if (!done) {
      // 유니티가 꺼져 있으면 크롬이 받은 파일을 직접 지운다
      for (const id of [job.downloadId, job.jsonDownloadId].filter(Boolean)) await chrome.downloads.removeFile(id).catch(() => {});
    }
  } else if (job.state === "importing") {
    throw new Error("이미 임포트 중이라 취소할 수 없어요");
  }
  await updateJobs((all) => {
    if (all[jobId]) Object.assign(all[jobId], { state: "cancelled", updatedAt: now() });
  });
  return "cancelled";
}

/** 받은 파일을 다른 프로젝트·태그로 다시 보내기 (보관본이 있으면 복사, 없으면 다시 받기) */
export async function resendJob(jobId, project, tag, notify) {
  const job = (await getJobs())[jobId];
  if (!job) throw new Error("기록이 없어요");
  const booth = { downloadableId: job.downloadableId, itemId: job.itemId, itemName: job.itemName, shopName: job.shopName, shopUrl: job.shopUrl, thumbnail: job.thumbnail, fileLabel: job.fileLabel };
  return startJob({ url: job.url, project, tag, booth, preferLocal: true }, notify);
}

export async function hideJobs(ids, hidden = true) {
  await updateJobs((all) => {
    for (const id of ids) if (all[id]) all[id].hidden = hidden;
  });
}

export async function removeJobs(ids) {
  await updateJobs((all) => {
    for (const id of ids) if (all[id] && !ACTIVE.has(all[id].state)) delete all[id];
  });
}

// ---- 부스 페이지 배지 ----------------------------------------------------------------
const STATUS_RANK = { importing: 5, queued: 4, downloading: 4, imported: 3, failed: 2, no_package: 1, cancelled: 0 };

export async function boothStatus({ itemIds = [], downloadableIds = [] }) {
  refreshJobs().catch(() => {});
  const jobs = Object.values(await getJobs()).filter((j) => j.state !== "cancelled");
  const view = (list) => {
    const byProject = new Map();
    for (const j of list.sort((a, b) => a.updatedAt - b.updatedAt)) byProject.set(`${j.project}|${j.tag}`, j);
    return [...byProject.values()].map((j) => ({ project: j.project, projectName: j.projectName, tag: j.tag, status: j.state }));
  };
  const out = { items: {}, downloadables: {} };
  for (const id of downloadableIds) {
    const list = jobs.filter((j) => j.downloadableId === id);
    if (!list.length) continue;
    const latest = list.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    out.downloadables[id] = {
      filename: latest.filename,
      present: list.some((j) => j.archivedPath),
      status: list.map((j) => j.state).sort((a, b) => (STATUS_RANK[b] || 0) - (STATUS_RANK[a] || 0))[0],
      projects: view(list),
    };
  }
  for (const id of itemIds) {
    const list = jobs.filter((j) => j.itemId === id);
    if (!list.length) continue;
    out.items[id] = { status: list[0].state, projects: view(list) };
  }
  return out;
}

// ---- 에셋 프리셋 ---------------------------------------------------------------
// 라이브러리에서 "받을 파일 + 저장 태그"만 모아 두었다가, 나중에 고른 프로젝트로 한 번에 보낸다.
const PRESETS_KEY = "bimPresets";
const ITEMFILES_KEY = "bimItemFiles"; // itemId -> { files: [{id, label}], seenAt } (라이브러리에서 본 최신 다운로드 목록)

export async function getItemFiles() {
  return (await chrome.storage.local.get(ITEMFILES_KEY))[ITEMFILES_KEY] || {};
}

/** 라이브러리에서 본 상품별 다운로드 목록 기록 (프리셋 업데이트 표시용) */
export async function recordItemFiles(items) {
  const map = await getItemFiles();
  let changed = false;
  for (const [itemId, files] of Object.entries(items || {})) {
    if (!itemId || !Array.isArray(files) || !files.length) continue;
    const prev = map[itemId];
    const same = prev && prev.files.length === files.length && prev.files.every((f) => files.some((x) => x.id === f.id));
    map[itemId] = { files: files.map((f) => ({ id: String(f.id), label: String(f.label || "") })), seenAt: now() };
    if (!same) changed = true;
  }
  await chrome.storage.local.set({ [ITEMFILES_KEY]: map, ...(changed ? { presetsVersion: Date.now() } : {}) });
  return changed;
}

/** 프리셋 항목의 상품 파일 목록이 담을 때와 달라졌는지 */
export function presetChanges(entry, itemFiles) {
  const cur = itemFiles[entry.itemId];
  if (!cur || !Array.isArray(entry.itemFiles) || !entry.itemFiles.length) return null;
  const was = new Set(entry.itemFiles.map((f) => f.id));
  const now_ = new Set(cur.files.map((f) => f.id));
  const added = cur.files.filter((f) => !was.has(f.id));
  const removed = entry.itemFiles.filter((f) => !now_.has(f.id));
  if (!added.length && !removed.length) return null;
  return { added, removed, missing: !now_.has(entry.downloadableId) };
}

// ---- 라이브러리 목록 (유니티 썸네일 매칭 도구용) -------------------------------------
// 다운로드\BoothImportManager\_bim\library.json 에 저장 → 유니티 'BIM 썸네일 매칭' 창이 읽는다.
export const LIBRARY_FILE = `${QUEUE_FOLDER}/_bim/library.json`;

export async function saveLibraryCatalog(items) {
  const list = (items || []).filter((i) => i && i.itemId);
  const data = { version: 1, savedAt: new Date().toISOString(), count: list.length, items: list };
  const dataUrl = toDataUrl(JSON.stringify(data));
  jsonTargets.set(dataUrl, LIBRARY_FILE);
  const id = await chrome.downloads.download({ url: dataUrl, filename: LIBRARY_FILE, conflictAction: "overwrite", saveAs: false });
  await chrome.storage.session.set({ [`json:${id}`]: "library" });
  // 프리셋 업데이트 확인용 파일 목록도 같이 갱신
  const files = {};
  for (const i of list) if (i.files?.length) files[i.itemId] = i.files.map((f) => ({ id: f.id, label: f.label }));
  await recordItemFiles(files).catch(() => {});
  await chrome.storage.local.set({ libraryExport: { at: Date.now(), count: list.length } });
  return { count: list.length, file: LIBRARY_FILE };
}

export async function getPresets() {
  return (await chrome.storage.local.get(PRESETS_KEY))[PRESETS_KEY] || [];
}

async function setPresets(list) {
  await chrome.storage.local.set({ [PRESETS_KEY]: list, presetsVersion: Date.now() });
  return list;
}

function presetEntry(e) {
  const downloadableId = String(e.downloadableId || (String(e.url || "").match(/downloadables\/(\d+)/) || [])[1] || "");
  return {
    downloadableId,
    url: e.url || (downloadableId ? `https://booth.pm/downloadables/${downloadableId}` : ""),
    fileLabel: e.fileLabel || "",
    tag: e.tag || UNTAGGED,
    itemId: String(e.itemId || ""),
    itemName: e.itemName || "",
    shopName: e.shopName || "",
    shopUrl: e.shopUrl || "",
    thumbnail: e.thumbnail || "",
    itemFiles: Array.isArray(e.itemFiles) ? e.itemFiles.map((f) => ({ id: String(f.id), label: String(f.label || "") })) : [],
    addedAt: e.addedAt || now(),
  };
}

export async function createPreset(name) {
  name = String(name || "").trim();
  if (!name) throw new Error("프리셋 이름을 입력하세요");
  const list = await getPresets();
  if (list.some((p) => p.name === name)) throw new Error("같은 이름의 프리셋이 있어요");
  const preset = { id: uid(), name, items: [], createdAt: now() };
  await setPresets([...list, preset]);
  return preset;
}

/** 파일을 프리셋에 넣거나(태그 갱신) 빼기. mode: "toggle" | "add" | "remove" */
export async function presetEdit(presetId, entries, mode = "toggle") {
  const list = await getPresets();
  const preset = list.find((p) => p.id === presetId);
  if (!preset) throw new Error("프리셋을 찾을 수 없어요");
  for (const raw of entries || []) {
    const e = presetEntry(raw);
    if (!e.downloadableId) continue;
    const i = preset.items.findIndex((x) => x.downloadableId === e.downloadableId);
    const remove = mode === "remove" || (mode === "toggle" && i >= 0 && preset.items[i].tag === e.tag);
    if (remove) {
      if (i >= 0) preset.items.splice(i, 1);
    } else if (i >= 0) {
      preset.items[i] = { ...preset.items[i], ...e, addedAt: preset.items[i].addedAt };
    } else {
      preset.items.push(e);
    }
  }
  preset.updatedAt = now();
  await setPresets(list);
  return preset;
}

/** 프리셋의 파일을 지정한 프로젝트로 한 번에 보내기 */
export async function sendPreset(presetId, project, onlyIds, notify) {
  if (!project) throw new Error("보낼 프로젝트를 고르세요");
  const preset = (await getPresets()).find((p) => p.id === presetId);
  if (!preset) throw new Error("프리셋을 찾을 수 없어요");
  const items = preset.items.filter((e) => !onlyIds?.length || onlyIds.includes(e.downloadableId));
  const results = [];
  for (const e of items) {
    try {
      const res = await startJob(
        {
          url: e.url,
          project,
          tag: e.tag,
          preferLocal: true,
          booth: { downloadableId: e.downloadableId, itemId: e.itemId, itemName: e.itemName, shopName: e.shopName, shopUrl: e.shopUrl, thumbnail: e.thumbnail, fileLabel: e.fileLabel },
        },
        notify,
      );
      results.push({ downloadableId: e.downloadableId, mode: res.mode });
    } catch (error) {
      results.push({ downloadableId: e.downloadableId, error: error.message });
    }
    await new Promise((r) => setTimeout(r, 400)); // 부스에 한꺼번에 몰리지 않게
  }
  return { sent: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error), total: items.length };
}

// 서비스워커가 알려줄 곳 (background 에서 지정)
let notifyHook = null;
export function setNotify(fn) {
  notifyHook = fn;
}

// ---- 관리 페이지·사이드패널용 (예전 로컬 앱 주소 흉내) ---------------------------------------
export async function route(path, method = "GET", body = {}) {
  const [p, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  switch (`${method} ${p}`) {
    case "GET /ping": {
      const list = await liveUnities({ maxAgeMs: 0 });
      return { ok: true, unities: list.filter((u) => !u.stale) };
    }
    case "GET /api/config": {
      const cfg = await getConfig();
      return { ...cfg, queueRoot: queueRootFor(cfg) };
    }
    case "POST /api/config": {
      const allowed = ["tags", "tagSets", "projectRoots", "extraProjects", "archiveDir", "keepArchive"];
      const patch = Object.fromEntries(Object.entries(body || {}).filter(([k]) => allowed.includes(k)));
      const cfg = await saveConfig(patch);
      if ("archiveDir" in patch || "keepArchive" in patch) {
        const unity = await anyUnity();
        if (unity) await pushUnityConfig(cfg, unity).catch(() => {});
      }
      return { status: "saved" };
    }
    case "GET /api/projects": {
      await liveUnities();
      return listProjects({ includeHidden: params.get("all") !== "0" });
    }
    case "POST /api/projects/scan":
      return scanProjects();
    case "GET /api/projects/suggest":
      return (await unityApi("/bim/suggest").catch(() => ({ items: [] }))).items || [];
    case "POST /api/projects/settings":
      return saveProjectSettings(body.updates);
    case "POST /api/projects/add": {
      const path = String(body.path || "").trim();
      if (!path) throw new Error("경로를 입력하세요");
      const cfg = await getConfig();
      if (!cfg.extraProjects.some((x) => x.toLowerCase() === path.toLowerCase())) await saveConfig({ extraProjects: [...cfg.extraProjects, path] });
      await scanProjects().catch(() => {});
      return { status: "added" };
    }
    case "POST /api/pick-folder": {
      const res = await unityApi("/bim/pick-folder", { initial: body.initial || "", title: body.title || "폴더 선택" }, { timeoutMs: 10 * 60 * 1000 });
      return { path: res.path || "" };
    }
    case "POST /api/reveal":
      return unityApi("/bim/reveal", { path: body.path });
    case "GET /api/jobs": {
      await refreshJobs({ force: true });
      // 설치 확인 기록(썸네일 매칭 등으로 이미 들어 있는 상품)은 보낸 기록 목록에서 뺀다
      return Object.values(await getJobs())
        .filter((j) => j.source !== "installed")
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    case "POST /api/jobs/cancel":
      return cancelJob(body.jobId);
    case "POST /api/jobs/resend": {
      const out = [];
      for (const id of body.jobIds || []) {
        try {
          out.push(await resendJob(id, body.project, body.tag));
        } catch (error) {
          out.push({ error: error.message });
        }
      }
      return out;
    }
    case "POST /api/jobs/hide":
      return hideJobs(body.jobIds || [], body.hidden !== false);
    case "POST /api/jobs/remove":
      return removeJobs(body.jobIds || []);
    case "GET /api/presets": {
      const { activePreset } = await chrome.storage.local.get("activePreset");
      const [presets, itemFiles] = await Promise.all([getPresets(), getItemFiles()]);
      const changes = {};
      for (const p of presets) for (const e of p.items) {
        const c = presetChanges(e, itemFiles);
        if (c) changes[`${p.id}:${e.downloadableId}`] = c;
      }
      return { presets, active: activePreset || "", changes };
    }
    case "POST /api/items/seen":
      return recordItemFiles(body.items);
    case "POST /api/presets/ack": {
      // 바뀐 다운로드 목록을 확인함 → 지금 목록을 기준으로
      const [list, itemFiles] = await Promise.all([getPresets(), getItemFiles()]);
      for (const p of list) {
        if (body.presetId && p.id !== body.presetId) continue;
        for (const e of p.items) if (e.itemId === body.itemId && itemFiles[e.itemId]) e.itemFiles = itemFiles[e.itemId].files;
      }
      await setPresets(list);
      return true;
    }
    case "POST /api/presets/create":
      return createPreset(body.name);
    case "POST /api/presets/edit":
      return presetEdit(body.presetId, body.entries, body.mode);
    case "POST /api/presets/save": {
      // 관리 페이지에서 이름·태그·순서를 고친 전체 목록
      const list = (body.presets || []).map((p) => ({ id: p.id || uid(), name: String(p.name || "").trim() || "이름 없음", createdAt: p.createdAt || now(), updatedAt: now(), items: (p.items || []).map(presetEntry) }));
      await setPresets(list);
      return list;
    }
    case "POST /api/presets/active":
      await chrome.storage.local.set({ activePreset: body.presetId || "" });
      return true;
    case "POST /api/presets/send":
      return sendPreset(body.presetId, body.project, body.only, notifyHook);
    default:
      throw new Error(`알 수 없는 요청: ${method} ${p}`);
  }
}
