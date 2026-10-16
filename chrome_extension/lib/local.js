// 관리 페이지·사이드패널 → 서비스워커(lib/core.js) 요청.
// v0.3 까지는 로컬 앱(exe)의 주소였지만, v0.4 부터는 확장 안에서 처리한다 (같은 주소 이름 유지).

export async function localApi(path, { method = "GET", body } = {}) {
  const res = await chrome.runtime.sendMessage({ type: "api", path, method, body });
  if (!res?.ok) throw new Error(res?.error || "응답 없음");
  return res.data;
}

/** 켜진 유니티 목록 */
export async function ping() {
  try {
    const res = await localApi("/ping");
    return { ok: true, unities: res.unities || [] };
  } catch (error) {
    return { ok: false, unities: [], error: error.message };
  }
}
