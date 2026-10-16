using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using BoothImportManager;
using UnityEngine;

namespace BoothThumbnailMatcher
{
    /// <summary>
    /// 크롬 확장이 저장한 BOOTH 라이브러리 목록 (다운로드\BoothImportManager\_bim\library.json).
    /// </summary>
    public static class BtmLibrary
    {
        [Serializable]
        public class FileInfo
        {
            public string id;
            public string label;
        }

        [Serializable]
        public class Item
        {
            public string itemId;
            public string name;
            public string shopName;
            public string shopUrl;
            public string thumbnail;
            public bool gift;
            public List<FileInfo> files = new List<FileInfo>();

            // ---- 비교용 (불러올 때 계산) ----
            [NonSerialized] public List<BtmText.Pre> nameVariants;   // 상품 이름 + 파일 이름 후보
            [NonSerialized] public List<BtmText.Pre> shopVariants;
            [NonSerialized] public string shopKey;

            public string ItemUrl => $"https://booth.pm/ja/items/{itemId}";
        }

        [Serializable]
        private class FileData
        {
            public int version;
            public string savedAt;
            public List<Item> items = new List<Item>();
        }

        public static List<Item> Items { get; private set; } = new List<Item>();
        public static Dictionary<string, Item> ById { get; private set; } = new Dictionary<string, Item>();
        public static string SavedAt { get; private set; } = "";
        public static DateTime LoadedStamp { get; private set; }
        public static string Error { get; private set; } = "";

        public static string FilePath => Path.Combine(BimContext.QueueRoot, "_bim", "library.json");

        public static DateTime FileStamp => File.Exists(FilePath) ? File.GetLastWriteTimeUtc(FilePath) : DateTime.MinValue;

        public static bool Loaded => Items.Count > 0;

        public static bool Changed => File.Exists(FilePath) && FileStamp != LoadedStamp;

        public static void Load()
        {
            Error = "";
            try
            {
                if (!File.Exists(FilePath))
                {
                    Items = new List<Item>();
                    ById = new Dictionary<string, Item>();
                    Error = "아직 라이브러리 목록이 없어요";
                    return;
                }
                LoadedStamp = FileStamp;
                var data = JsonUtility.FromJson<FileData>(File.ReadAllText(FilePath, Encoding.UTF8)) ?? new FileData();
                SavedAt = data.savedAt ?? "";
                Items = (data.items ?? new List<Item>()).Where(i => !string.IsNullOrEmpty(i.itemId)).ToList();
                ComputeCommon(Items);
                foreach (var i in Items) Prepare(i);
                ById = new Dictionary<string, Item>();
                foreach (var i in Items) ById[i.itemId] = i;
            }
            catch (Exception e)
            {
                Error = $"라이브러리 목록을 읽지 못했어요: {e.Message}";
                Items = new List<Item>();
                ById = new Dictionary<string, Item>();
            }
        }

        public static string ShopKeyOf(string shopUrl, string shopName)
        {
            try
            {
                if (!string.IsNullOrEmpty(shopUrl)) return new Uri(shopUrl).Host.Split('.')[0].ToLowerInvariant();
            }
            catch
            {
                // 이름으로
            }
            return BtmText.Compact(BtmText.Norm(shopName));
        }

        /// <summary>여러 샵의 파일 이름에 나오는 단어 = 아바타 이름 등 (샵 수의 2% 이상, 최소 5곳)</summary>
        private static void ComputeCommon(List<Item> items)
        {
            var byToken = new Dictionary<string, HashSet<string>>();
            var shops = new HashSet<string>();
            foreach (var i in items)
            {
                var shop = !string.IsNullOrEmpty(i.shopUrl) ? i.shopUrl : i.shopName ?? "";
                shops.Add(shop);
                var tokens = new HashSet<string>();
                foreach (var f in i.files ?? new List<FileInfo>())
                    foreach (var v in BtmText.FileVariants(f.label))
                        foreach (var t in BtmText.TokensOf(v))
                            tokens.Add(t);
                foreach (var t in tokens)
                {
                    if (!byToken.TryGetValue(t, out var set)) byToken[t] = set = new HashSet<string>();
                    set.Add(shop);
                }
            }
            var threshold = Math.Max(5, shops.Count * 0.02);
            BtmText.SetCommon(byToken.Where(kv => kv.Value.Count >= threshold).Select(kv => kv.Key));
        }

        public static void Prepare(Item i)
        {
            i.name = i.name ?? "";
            i.shopName = i.shopName ?? "";
            i.files = i.files ?? new List<FileInfo>();
            var names = BtmText.NameVariants(i.name);
            foreach (var f in i.files)
                foreach (var v in BtmText.FileVariants(f.label))
                {
                    if (!names.Contains(v)) names.Add(v);
                    // "hadasoi_airi.zip" → "hadasoi" (아바타 이름을 뗀 것도 후보로)
                    var stripped = BtmText.StripCommon(v);
                    if (stripped != v && BtmText.Compact(stripped).Length >= 3 && !names.Contains(stripped)) names.Add(stripped);
                }
            i.nameVariants = BtmText.PrepareAll(names);
            i.shopKey = ShopKeyOf(i.shopUrl, i.shopName);
            var shops = BtmText.NameVariants(i.shopName);
            if (!string.IsNullOrEmpty(i.shopKey))
            {
                var n = BtmText.Norm(i.shopKey.Replace('-', ' ').Replace('_', ' '));
                if (n.Length >= 2 && !shops.Contains(n)) shops.Add(n);
            }
            i.shopVariants = BtmText.PrepareAll(shops);
        }

        /// <summary>파일 이름(원본 zip/unitypackage)으로 상품 찾기</summary>
        public static Item FindByFileName(string fileName)
        {
            if (string.IsNullOrEmpty(fileName)) return null;
            var key = NormFile(fileName);
            foreach (var i in Items)
                foreach (var f in i.files)
                    if (NormFile(f.label) == key) return i;
            return null;
        }

        private static string NormFile(string name)
        {
            name = (name ?? "").Trim().ToLowerInvariant();
            // 크롬이 붙인 " (2)" 같은 중복 표시 제거
            var ext = Path.GetExtension(name);
            var stem = name.Substring(0, name.Length - ext.Length);
            stem = System.Text.RegularExpressions.Regex.Replace(stem, @"\s\(\d+\)$", "");
            return stem + ext;
        }
    }
}
