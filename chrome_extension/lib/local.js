// 로컬 앱(BoothImportManager.exe) 통신. 확장 페이지/서비스워커에서만 사용.
// 콘텐츠 스크립트는 이 모듈을 쓰지 않고 background 로 메시지를 보낸다
// (로컬 앱은 chrome-extension:// 출처만 허용하기 때문).

export const DEFAULT_PORT = 7831;

export async function getPort() {
  try {
    const { localPort } = await chrome.storage.local.get("localPort");
    const port = Number(localPort);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

export async function localApi(path, { method = "GET", body, timeoutMs = 60000 } = {}) {
  const port = await getPort();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("로컬 앱 응답 시간 초과");
    if (error instanceof TypeError) throw new Error("로컬 앱이 꺼져 있어요 (BoothImportManager.exe 실행 필요)");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function ping() {
  try {
    const res = await localApi("/ping", { timeoutMs: 2500 });
    return { ok: true, version: res.version || "0.2" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
