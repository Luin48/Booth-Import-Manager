// BOOTH 다크 테마 (설정: boothTheme = "light" | "dark")
//
// 화면을 반전시키지 않고, 부스가 쓰는 CSS 의 색 선언을 하나씩 읽어서
// 다크 팔레트로 다시 계산한 스타일시트를 만든다. (호버 같은 상태도 그대로 살아 있음)
// 그 다음 인라인 색과 글자 대비가 부족한 곳만 따로 보정한다.
// 만든 CSS 는 스타일시트 주소별로 캐시해서 다음 방문 때 첫 화면부터 바로 적용한다.
(() => {
  if (window.__bimTheme) return;
  window.__bimTheme = true;

  const ROOT = document.documentElement;
  const FLAG_KEY = "bim-booth-theme"; // 페이지 localStorage: 첫 페인트 전에 동기적으로 읽기용
  const CACHE_PREFIX = "darkcss:";
  const CACHE_VERSION = "v1";
  const BG = "#16181c";

  // ---- 색 계산 -------------------------------------------------------------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
  }

  const luminance = (r, g, b) => {
    const c = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(...a), luminance(...b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };

  // 색 문자열 하나를 [r,g,b,a, alphaText] 로. alphaText 는 "/var(--tw-bg-opacity)" 같은 원본 알파 표현.
  function parseColor(str) {
    str = str.trim().toLowerCase();
    if (NAMED[str]) return { rgb: NAMED[str].slice(0, 3), a: 1, alphaRaw: null };
    let m = str.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let hex = m[1];
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
      const n = parseInt(hex.slice(0, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
      return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a, alphaRaw: null };
    }
    m = str.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*(.+?))?\s*\)$/);
    if (m) {
      const raw = m[4];
      let a = 1;
      let alphaRaw = null;
      if (raw !== undefined) {
        if (/^[\d.]+%?$/.test(raw)) a = raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
        else alphaRaw = raw; // var(--tw-...-opacity) 등은 그대로 보존
      }
      return { rgb: [+m[1], +m[2], +m[3]], a, alphaRaw };
    }
    return null;
  }

  function formatColor(rgb, a, alphaRaw) {
    const [r, g, b] = rgb.map((v) => Math.round(clamp(v, 0, 255)));
    if (alphaRaw) return `rgb(${r} ${g} ${b} / ${alphaRaw})`;
    if (a >= 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;
  }

  // 배경: 밝은 면은 어두운 면으로, 은은한 검정 오버레이는 은은한 흰색으로
  function mapBg(c) {
    const [h, s, l] = rgbToHsl(...c.rgb);
    if (c.a < 1 && l < 0.15) return formatColor([255, 255, 255], Math.min(c.a * 1.6, 0.6), c.alphaRaw); // 검정 반투명 → 흰색 반투명
    if (l < 0.3) return null; // 이미 어두움(푸터, 모달 딤 등)
    if (s > 0.45 && l < 0.8) return null; // 브랜드 색 버튼(빨간 장바구니 등)은 그대로
    // 아주 밝은 면(흰 카드 / 연회색 바탕)은 순서를 살짝 뒤집어 카드가 바탕보다 조금 밝게 (다크 UI 관례)
    const nl = l >= 0.9 ? 0.1 + (l - 0.9) * 0.45 : clamp(0.1 + (0.9 - l) * 0.3, 0.1, 0.28);
    return formatColor(hslToRgb(h, Math.min(s, 0.55) * 0.6, nl), c.a, c.alphaRaw);
  }

  // 글자: 어두운 글자는 밝게(진할수록 더 밝게), 원래 연한 글자는 조금 덜 밝게
  function mapText(c) {
    const [h, s, l] = rgbToHsl(...c.rgb);
    if (c.a < 1 && l < 0.15) return formatColor([255, 255, 255], clamp(c.a * 1.1, 0.45, 0.92), c.alphaRaw);
    if (l >= 0.72) return null;
    if (s > 0.35) {
      // 색 있는 글자(링크·가격 등)는 색상 유지하고 밝기만 올림
      return formatColor(hslToRgb(h, Math.min(s, 0.85), clamp(1 - l * 0.55, 0.66, 0.82)), c.a, c.alphaRaw);
    }
    return formatColor(hslToRgb(h, s * 0.4, clamp(0.94 - l * 0.45, 0.66, 0.92)), c.a, c.alphaRaw);
  }

  function mapBorder(c) {
    const [h, s, l] = rgbToHsl(...c.rgb);
    if (c.a < 1 && l < 0.2) return formatColor([255, 255, 255], clamp(c.a * 1.4, 0.08, 0.3), c.alphaRaw);
    if (l < 0.35) return null;
    if (s > 0.45 && l < 0.7) return null;
    return formatColor(hslToRgb(h, s * 0.4, clamp(0.16 + (1 - l) * 0.4, 0.18, 0.32)), c.a, c.alphaRaw);
  }

  function mapValue(value, mapper) {
    if (!value || /var\(|url\(|gradient|currentcolor|inherit|initial|unset|transparent/i.test(value)) {
      // rgb(… / var(--tw-…-opacity)) 형태만 예외로 처리
      if (!/^rgba?\([\d.\s,]+\/\s*var\(--tw-[a-z-]+opacity[^)]*\)\s*\)$/i.test(value || "")) return null;
    }
    const c = parseColor(value);
    if (!c) return null;
    return mapper(c);
  }

  const PROPS = [
    ["background-color", mapBg],
    ["color", mapText],
    ["border-top-color", mapBorder],
    ["border-right-color", mapBorder],
    ["border-bottom-color", mapBorder],
    ["border-left-color", mapBorder],
    ["outline-color", mapBorder],
    ["fill", mapText],
    ["stroke", mapText],
    ["caret-color", mapText],
  ];

  function mapperForVar(name) {
    if (/text|link|icon|fg|foreground|font/i.test(name)) return mapText;
    if (/border|divider|line|outline/i.test(name)) return mapBorder;
    return mapBg; // background, surface, 기타
  }

  function scopeSelector(sel) {
    return sel
      .split(",")
      .map((s) => {
        s = s.trim();
        if (!s) return s;
        if (/^:root\b/.test(s)) return s.replace(/^:root/, "html.bim-site-dark");
        if (/^html\b/.test(s)) return s.replace(/^html/, "html.bim-site-dark");
        return `html.bim-site-dark ${s}`;
      })
      .join(", ");
  }

  function convertRules(rules, out) {
    for (const rule of rules) {
      if (rule.type === CSSRule.STYLE_RULE) {
        const decls = [];
        const st = rule.style;
        for (const [prop, mapper] of PROPS) {
          const v = st.getPropertyValue(prop);
          if (!v) continue;
          const mapped = mapValue(v, mapper);
          if (mapped) decls.push(`${prop}: ${mapped} !important`);
        }
        for (let i = 0; i < st.length; i += 1) {
          const name = st[i];
          if (!name.startsWith("--") || name.startsWith("--tw-")) continue;
          const v = st.getPropertyValue(name).trim();
          const mapped = mapValue(v, mapperForVar(name));
          if (mapped) decls.push(`${name}: ${mapped} !important`);
        }
        if (decls.length) out.push(`${scopeSelector(rule.selectorText)} { ${decls.join("; ")} }`);
      } else if (rule.cssRules && (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE || (window.CSSLayerBlockRule && rule instanceof CSSLayerBlockRule))) {
        const inner = [];
        convertRules(rule.cssRules, inner);
        if (inner.length) out.push(`${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{ ${inner.join("\n")} }`);
      }
    }
  }

  function convertCssText(text) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text.replace(/@import[^;]+;/g, ""));
      const out = [];
      convertRules(sheet.cssRules, out);
      return out.join("\n");
    } catch {
      return "";
    }
  }

  // ---- 기본 스타일 (모든 부스 페이지 공통) --------------------------------------
  const BASE_CSS = `
html.bim-site-dark { color-scheme: dark; background: ${BG} !important; }
html.bim-site-dark body { background-color: ${BG} !important; color: #e6e8eb; }
html.bim-site-dark ::selection { background: #2f6f95; color: #fff; }
html.bim-site-dark input, html.bim-site-dark textarea, html.bim-site-dark select {
  background-color: #23272e; color: #e6e8eb; border-color: #3a404a;
}
html.bim-site-dark input::placeholder, html.bim-site-dark textarea::placeholder { color: #8b929c !important; }
html.bim-site-dark img:not([src*=".svg"]) { filter: brightness(0.94); }
html.bim-site-dark ::-webkit-scrollbar { background: ${BG}; }
html.bim-site-dark ::-webkit-scrollbar-thumb { background: #3a404a; border-radius: 6px; }
`;

  // ---- 적용 / 해제 -----------------------------------------------------------
  let enabled = false;
  const styleEls = new Map(); // key -> <style>
  function putStyle(key, css) {
    let el = styleEls.get(key);
    if (!el) {
      el = document.createElement("style");
      el.dataset.bimTheme = key;
      styleEls.set(key, el);
    }
    el.textContent = css;
    const parent = document.head || ROOT;
    if (el.parentNode !== parent || el !== parent.lastElementChild) parent.appendChild(el);
  }

  function setFlag(on) {
    try {
      localStorage.setItem(FLAG_KEY, on ? "dark" : "light");
    } catch {
      /* 무시 */
    }
  }

  // 첫 페인트 전에: 지난번 설정이 다크였으면 바로 어둡게
  let earlyDark = false;
  try {
    earlyDark = localStorage.getItem(FLAG_KEY) === "dark";
  } catch {
    /* 무시 */
  }
  if (earlyDark) {
    ROOT.classList.add("bim-site-dark", "bim-dark");
    putStyle("base", BASE_CSS);
  }

  // 스타일시트 목록. 같은 출처(인라인 <style>, CSS-in-JS 가 insertRule 로 넣은 규칙 포함)는
  // cssRules 를 바로 읽고, 다른 출처(asset.booth.pm 의 .css)는 내려받아서 변환한다.
  const sheetIds = new WeakMap();
  const sheetRuleCount = new WeakMap();
  let sheetSeq = 0;

  function sheetSources() {
    const list = [];
    for (const sheet of document.styleSheets) {
      const owner = sheet.ownerNode;
      if (owner?.dataset?.bimTheme) continue;
      if (sheet.href && sheet.href.startsWith("chrome-extension:")) continue;
      let rules = null;
      try {
        rules = sheet.cssRules;
      } catch {
        rules = null; // 다른 출처
      }
      if (sheet.href && !rules) {
        list.push({ key: sheet.href.split("?")[0], href: sheet.href });
        continue;
      }
      if (!rules) continue;
      if (!sheetIds.has(sheet)) sheetIds.set(sheet, `local:${(sheetSeq += 1)}`);
      list.push({ key: sheetIds.get(sheet), sheet, count: rules.length });
    }
    return list;
  }

  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  const done = new Set();
  let converting = false;
  async function convertAll() {
    if (!enabled || converting) return;
    converting = true;
    try {
      const sources = sheetSources();
      // 같은 출처 시트: 규칙 수가 바뀌었을 때만 다시 변환 (CSS-in-JS 대응)
      for (const src of sources.filter((x) => x.sheet)) {
        if (sheetRuleCount.get(src.sheet) === src.count) continue;
        sheetRuleCount.set(src.sheet, src.count);
        const out = [];
        try {
          convertRules(src.sheet.cssRules, out);
        } catch {
          /* 무시 */
        }
        if (enabled) {
          if (out.length) putStyle(src.key, out.join("\n"));
          else removeStyle(src.key);
        }
      }
      // 다른 출처 시트: 주소별 캐시
      const remote = sources.filter((x) => x.href && !done.has(x.key));
      if (remote.length) {
        const keys = remote.map((x) => CACHE_PREFIX + CACHE_VERSION + x.key);
        const cached = await chrome.storage.local.get(keys);
        for (const src of remote) {
          done.add(src.key);
          const ck = CACHE_PREFIX + CACHE_VERSION + src.key;
          let css = cached[ck];
          if (css == null) {
            let text = "";
            try {
              text = await fetch(src.href, { credentials: "omit" }).then((r) => (r.ok ? r.text() : ""));
            } catch {
              text = "";
            }
            css = convertCssText(text);
            if (css) chrome.storage.local.set({ [ck]: css }).catch(() => {});
          }
          if (css && enabled) putStyle(src.key, css);
        }
      }
    } finally {
      converting = false;
    }
    scheduleFix();
  }

  function removeStyle(key) {
    const el = styleEls.get(key);
    if (el) {
      el.remove();
      styleEls.delete(key);
    }
  }

  // ---- 인라인 색 / 대비 보정 --------------------------------------------------
  // 성능: 읽기(getComputedStyle)와 쓰기(style.setProperty)를 섞으면 매번 전체 스타일을 다시 계산해서
  // 페이지가 멈춘다. 그래서 묶음마다 '전부 읽기 → 전부 쓰기' 순서로 나눠서, 유휴 시간에 조금씩 처리한다.
  const SKIP_TAGS = /^(SCRIPT|STYLE|LINK|META|IMG|SVG|PATH|G|USE|VIDEO|CANVAS|IFRAME|NOSCRIPT|BR|HR|SOURCE|PICTURE)$/i;
  const OWN_UI = ".bim-picker, .bim-panel, .bim-cardbar, .bim-inline, .bim-banner, .bim-libbar, #bim-toast, .bim-chips";
  let bgCache = new WeakMap();
  let pendingBg = new WeakMap(); // 이번 묶음에서 바꿀 인라인 배경 (아직 안 썼지만 대비 계산엔 반영)

  function effectiveBg(el) {
    if (!el || el.nodeType !== 1) return [22, 24, 28];
    if (bgCache.has(el)) return bgCache.get(el);
    let result;
    if (pendingBg.has(el)) result = pendingBg.get(el);
    else {
      const cs = getComputedStyle(el);
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0.5) result = c.rgb;
      else if (cs.backgroundImage !== "none") result = null; // 이미지 위 글자는 건드리지 않음
      else result = effectiveBg(el.parentElement);
    }
    bgCache.set(el, result);
    return result;
  }

  function planElement(el, writes) {
    if (el.closest(OWN_UI)) return;
    // 1) 인라인 style 의 색 (계산 없이 style 속성만 읽음)
    const inline = el.getAttribute("style");
    if (inline && /color|background/i.test(inline) && !el.dataset.bimInline) {
      for (const [prop, mapper] of PROPS) {
        const v = el.style.getPropertyValue(prop);
        if (!v || el.style.getPropertyPriority(prop) === "important") continue;
        const mapped = mapValue(v, mapper);
        if (!mapped) continue;
        writes.push([el, prop, mapped]);
        if (prop === "background-color") {
          const pc = parseColor(mapped);
          if (pc) pendingBg.set(el, pc.rgb);
        }
      }
      writes.push([el, "data-bim-inline"]);
    }
    // 2) 글자 대비 (직접 글자를 가진 요소만)
    let hasText = false;
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim()) {
        hasText = true;
        break;
      }
    }
    if (!hasText || el.dataset.bimFixed) return;
    const fg = parseColor(getComputedStyle(el).color);
    const bg = effectiveBg(el);
    if (!fg || !bg || fg.a < 0.3) return;
    if (contrast(fg.rgb, bg) >= 4) return;
    const [, bs, bl] = rgbToHsl(...bg);
    if (bs > 0.4 && bl > 0.3 && bl < 0.8) return; // 색 있는 버튼 위 글자는 원래 디자인 유지
    const light = [230, 232, 235];
    const dark = [31, 31, 31];
    writes.push([el, "color", contrast(light, bg) >= contrast(dark, bg) ? "#e6e8eb" : "#1f1f1f", true]);
  }

  function applyWrites(writes) {
    for (const [el, prop, value, fixed] of writes) {
      if (prop === "data-bim-inline") el.dataset.bimInline = "1";
      else {
        el.style.setProperty(prop, value, "important");
        if (fixed) el.dataset.bimFixed = "1";
      }
    }
  }

  let fixTimer = null;
  let queue = [];
  const queued = new WeakSet();
  function enqueue(root) {
    if (!root || root.nodeType !== 1) return;
    const push = (el) => {
      if (queued.has(el) || SKIP_TAGS.test(el.tagName)) return;
      queued.add(el);
      queue.push(el);
    };
    push(root);
    for (const el of root.getElementsByTagName("*")) push(el);
  }

  function processQueue(deadline) {
    const started = performance.now();
    while (queue.length && enabled) {
      const chunk = queue.splice(0, 300);
      bgCache = new WeakMap();
      pendingBg = new WeakMap();
      const writes = [];
      for (const el of chunk) {
        queued.delete(el);
        if (el.isConnected) planElement(el, writes);
      }
      applyWrites(writes);
      const budgetLeft = deadline?.timeRemaining ? deadline.timeRemaining() > 4 : performance.now() - started < 12;
      if (!budgetLeft) break;
    }
    if (queue.length && enabled) idle(processQueue);
  }
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(() => fn(null), 16));

  function scheduleFix(nodes) {
    if (!enabled) return;
    clearTimeout(fixTimer);
    fixTimer = setTimeout(() => {
      if (nodes) nodes.forEach(enqueue);
      else enqueue(document.body);
      idle(processQueue);
    }, 200);
  }

  let sheetTimer = null;
  const observer = new MutationObserver((records) => {
    const added = [];
    let newSheet = false;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1 || n.dataset?.bimTheme) continue;
        if (n.tagName === "STYLE" || (n.tagName === "LINK" && n.rel === "stylesheet")) newSheet = true;
        else added.push(n);
      }
    }
    if (newSheet || added.length) {
      clearTimeout(sheetTimer);
      sheetTimer = setTimeout(convertAll, newSheet ? 50 : 400);
    }
    if (added.length && enabled) {
      added.forEach(enqueue);
      idle(processQueue);
    }
  });

  function undoFixes() {
    queue = [];
    for (const el of document.querySelectorAll("[data-bim-fixed]")) {
      el.style.removeProperty("color");
      delete el.dataset.bimFixed;
    }
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    setFlag(true);
    ROOT.classList.add("bim-site-dark", "bim-dark");
    putStyle("base", BASE_CSS);
    observer.observe(ROOT, { childList: true, subtree: true });
    const start = () => convertAll();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    window.addEventListener("load", () => setTimeout(convertAll, 100), { once: true });
    // CSS-in-JS 는 나중에 규칙을 넣기도 해서, 처음 20초 동안은 가끔 다시 확인
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (!enabled || ticks > 10) return clearInterval(timer);
      convertAll();
    }, 2000);
  }

  function disable() {
    const hadInline = document.querySelector("[data-bim-inline]");
    enabled = false;
    setFlag(false);
    observer.disconnect();
    ROOT.classList.remove("bim-site-dark", "bim-dark");
    for (const el of styleEls.values()) el.remove();
    styleEls.clear();
    done.clear();
    undoFixes();
    if (hadInline) location.reload(); // 인라인 색까지 깨끗하게 되돌리기
  }

  chrome.storage.local.get("boothTheme").then(({ boothTheme }) => {
    if (boothTheme === "dark") enable();
    else if (earlyDark) disable();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.boothTheme) return;
    if (changes.boothTheme.newValue === "dark") enable();
    else disable();
  });
})();
