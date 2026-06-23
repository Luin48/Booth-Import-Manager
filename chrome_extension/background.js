const LOCAL_ENDPOINT = "http://127.0.0.1:7831/api/download-complete";

function isBoothDownload(item) {
  const fields = [item.url, item.finalUrl, item.referrer].filter(Boolean);
  return fields.some((value) => value.includes("booth.pm"));
}

async function notifyLocalApp(item) {
  if (!item.filename || !isBoothDownload(item)) return;
  const filename = item.filename.split(/[\\/]/).pop();
  if (!filename) return;

  await fetch(LOCAL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      sourceUrl: item.url || "",
      finalUrl: item.finalUrl || "",
      referrer: item.referrer || "",
    }),
  });
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state || delta.state.current !== "complete") return;
  chrome.downloads.search({ id: delta.id }, (items) => {
    const item = items && items[0];
    if (!item) return;
    notifyLocalApp(item).catch(() => undefined);
  });
});
