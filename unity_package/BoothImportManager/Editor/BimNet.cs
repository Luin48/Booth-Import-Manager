using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;

namespace BoothImportManager
{
    /// <summary>부스 상품 정보/썸네일 받기 (백그라운드 스레드 전용).</summary>
    public static class BimNet
    {
        private const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BoothImportManager/" + BimContext.Version;

        public static byte[] GetBytes(string url, int timeoutMs = 20000)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = UA;
            req.Referer = "https://booth.pm/";
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var s = res.GetResponseStream())
            using (var ms = new MemoryStream())
            {
                s?.CopyTo(ms);
                return ms.ToArray();
            }
        }

        [Serializable] private class ItemImage { public string original; public string resized; }
        [Serializable] private class ItemShop { public string name; public string subdomain; public string url; public string thumbnail_url; }
        [Serializable] private class ItemJson { public long id; public string name; public string url; public ItemImage[] images; public ItemShop shop; }

        public static string ItemIdFrom(string value)
        {
            value = (value ?? "").Trim();
            if (Regex.IsMatch(value, "^\\d+$")) return value;
            var m = Regex.Match(value, "items/(\\d+)");
            return m.Success ? m.Groups[1].Value : "";
        }

        public static string BigItemThumb(string url) =>
            string.IsNullOrEmpty(url) ? "" : url.Replace("/c/72x72_a2_g5/", "/c/300x300_a2_g5/");

        public static string BigShopIcon(string url) =>
            string.IsNullOrEmpty(url) ? "" : url.Replace("/c/48x48/", "/c/128x128/");

        /// <summary>상품 번호로 이름/샵/썸네일 주소를 채운다.</summary>
        public static BoothFolderIcons.BoothMeta FetchItem(string itemIdOrUrl)
        {
            var id = ItemIdFrom(itemIdOrUrl);
            if (string.IsNullOrEmpty(id)) throw new ArgumentException("상품 번호를 알 수 없어요");
            var json = Encoding.UTF8.GetString(GetBytes($"https://booth.pm/ja/items/{id}.json"));
            var data = JsonUtility.FromJson<ItemJson>(json);
            var image = data?.images != null && data.images.Length > 0 ? data.images[0] : null;
            return new BoothFolderIcons.BoothMeta
            {
                itemId = id,
                itemName = data?.name ?? "",
                itemUrl = string.IsNullOrEmpty(data?.url) ? $"https://booth.pm/ja/items/{id}" : data.url,
                shopName = data?.shop?.name ?? "",
                shopUrl = data?.shop?.url ?? "",
                itemThumbUrl = BigItemThumb(image?.resized ?? image?.original ?? ""),
                shopIconUrl = BigShopIcon(data?.shop?.thumbnail_url ?? ""),
            };
        }

        /// <summary>썸네일을 공용 캐시 폴더에 받아 경로를 돌려준다. 실패하면 "".</summary>
        public static string CacheImage(string url, string name)
        {
            if (string.IsNullOrEmpty(url)) return "";
            try
            {
                Directory.CreateDirectory(BimContext.ThumbDir);
                var ext = Path.GetExtension(new Uri(url).AbsolutePath);
                if (string.IsNullOrEmpty(ext) || ext.Length > 5) ext = ".jpg";
                var target = Path.Combine(BimContext.ThumbDir, BimContext.SafeFileName(name) + ext);
                if (File.Exists(target) && new FileInfo(target).Length > 0) return target;
                var bytes = GetBytes(url);
                var tmp = target + ".part";
                File.WriteAllBytes(tmp, bytes);
                if (File.Exists(target)) File.Delete(target);
                File.Move(tmp, target);
                return target;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BoothImportManager] 썸네일 받기 실패: {url} - {e.Message}");
                return "";
            }
        }

        public static string ShopKey(BoothFolderIcons.BoothMeta meta)
        {
            var src = !string.IsNullOrEmpty(meta.shopUrl) ? new Uri(meta.shopUrl).Host.Split('.')[0] : meta.shopName;
            return "shop_" + Regex.Replace(src ?? "shop", "[^A-Za-z0-9_-]", "_");
        }

        /// <summary>메타의 썸네일 주소를 받아서 itemThumb/shopIcon(로컬 경로)을 채운다.</summary>
        public static void EnsureThumbs(BoothFolderIcons.BoothMeta meta)
        {
            if (meta == null || string.IsNullOrEmpty(meta.itemId)) return;
            if (string.IsNullOrEmpty(meta.itemThumbUrl) && string.IsNullOrEmpty(meta.shopIconUrl))
            {
                try
                {
                    var fetched = FetchItem(meta.itemId);
                    meta.itemThumbUrl = fetched.itemThumbUrl;
                    meta.shopIconUrl = fetched.shopIconUrl;
                    if (string.IsNullOrEmpty(meta.shopName)) meta.shopName = fetched.shopName;
                    if (string.IsNullOrEmpty(meta.shopUrl)) meta.shopUrl = fetched.shopUrl;
                    if (string.IsNullOrEmpty(meta.itemName)) meta.itemName = fetched.itemName;
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[BoothImportManager] 상품 정보 받기 실패 ({meta.itemId}): {e.Message}");
                }
            }
            if (string.IsNullOrEmpty(meta.itemThumb) || !File.Exists(meta.itemThumb))
                meta.itemThumb = CacheImage(meta.itemThumbUrl, "item_" + meta.itemId);
            if ((string.IsNullOrEmpty(meta.shopIcon) || !File.Exists(meta.shopIcon)) && !string.IsNullOrEmpty(meta.shopIconUrl))
            {
                string key;
                try { key = ShopKey(meta); } catch { key = "shop_" + meta.itemId; }
                meta.shopIcon = CacheImage(meta.shopIconUrl, key);
            }
        }
    }
}
