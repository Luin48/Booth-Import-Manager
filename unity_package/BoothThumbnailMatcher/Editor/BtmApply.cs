using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using BoothImportManager;
using UnityEditor;
using UnityEngine;

namespace BoothThumbnailMatcher
{
    /// <summary>
    /// 고른 결과를 실제 폴더 아이콘으로: 부스에서 상품 정보·썸네일·샵 사진을 받아 BIM 폴더 아이콘으로 등록.
    /// </summary>
    public static class BtmApply
    {
        public class Job
        {
            public string folder;
            public string kind;
            public BtmLibrary.Item item;
        }

        public static bool Running { get; private set; }
        public static string Progress { get; private set; } = "";
        public static float Fraction { get; private set; }
        private static volatile bool cancel;

        public static void Cancel() => cancel = true;

        /// <summary>적용 목록 만들기. 상품 폴더의 상위 폴더가 샵 이름과 비슷하면(옵션) 샵 사진도 붙인다.</summary>
        public static List<Job> Plan(IEnumerable<BtmMatcher.Result> results, bool shopParent, HashSet<string> plannedShopFolders)
        {
            var jobs = new List<Job>();
            var taken = new HashSet<string>(plannedShopFolders ?? new HashSet<string>());
            foreach (var r in results)
            {
                if (r.chosen?.item == null) continue;
                jobs.Add(new Job { folder = r.Path, kind = r.kind, item = r.chosen.item });
                if (r.kind == "shop") taken.Add(r.Path);
            }
            if (shopParent)
            {
                foreach (var j in jobs.Where(j => j.kind == "item").ToList())
                {
                    var parent = Path.GetDirectoryName(j.folder)?.Replace('\\', '/');
                    if (string.IsNullOrEmpty(parent) || parent == "Assets" || taken.Contains(parent)) continue;
                    var guid = AssetDatabase.AssetPathToGUID(parent);
                    if (BoothFolderIcons.HasIcon(guid) || BtmState.IsCategory(guid)) continue;
                    var name = Path.GetFileName(parent);
                    if (BtmText.LooksLikeCategory(name)) continue;
                    if (BtmText.Best(BtmText.FolderVariants(name), j.item.shopVariants) < 0.5) continue;
                    jobs.Add(new Job { folder = parent, kind = "shop", item = j.item });
                    taken.Add(parent);
                }
            }
            return jobs;
        }

        public static void Run(List<Job> jobs, Action<int, int> done)
        {
            if (Running || jobs.Count == 0) return;
            Running = true;
            cancel = false;
            Fraction = 0;
            Progress = "준비 중…";
            Task.Run(() =>
            {
                var metas = new Dictionary<string, BoothFolderIcons.BoothMeta>();
                var ok = 0;
                var failed = 0;
                for (var n = 0; n < jobs.Count; n++)
                {
                    if (cancel) break;
                    var job = jobs[n];
                    Progress = $"썸네일 받는 중 ({n + 1}/{jobs.Count}) {job.item.name}";
                    Fraction = (float)n / jobs.Count;
                    try
                    {
                        if (!metas.TryGetValue(job.item.itemId, out var meta))
                        {
                            meta = Fetch(job.item);
                            metas[job.item.itemId] = meta;
                        }
                        var image = job.kind == "shop" ? meta.shopIcon : meta.itemThumb;
                        if (string.IsNullOrEmpty(image))
                        {
                            failed++;
                            continue;
                        }
                        var folder = job.folder;
                        var kind = job.kind;
                        var m = meta;
                        BimContext.RunOnMain(() =>
                        {
                            BoothFolderIcons.Assign(folder, kind, image, m);
                            return true;
                        }, 30000);
                        ok++;
                    }
                    catch (Exception e)
                    {
                        failed++;
                        Debug.LogWarning($"[BIM 썸네일 매칭] {job.folder}: {e.Message}");
                    }
                }
                BimContext.Post(() =>
                {
                    Running = false;
                    Progress = "";
                    Fraction = 1;
                    done?.Invoke(ok, failed);
                });
            });
        }

        private static BoothFolderIcons.BoothMeta Fetch(BtmLibrary.Item item)
        {
            BoothFolderIcons.BoothMeta meta;
            try
            {
                meta = BimNet.FetchItem(item.itemId);
            }
            catch
            {
                // 판매 중지 등으로 상품 정보를 못 받으면 라이브러리에 있던 정보로
                meta = new BoothFolderIcons.BoothMeta
                {
                    itemId = item.itemId,
                    itemName = item.name,
                    itemUrl = item.ItemUrl,
                    shopName = item.shopName,
                    shopUrl = item.shopUrl,
                    itemThumbUrl = BimNet.BigItemThumb(item.thumbnail ?? ""),
                };
            }
            if (string.IsNullOrEmpty(meta.itemName)) meta.itemName = item.name;
            if (string.IsNullOrEmpty(meta.shopName)) meta.shopName = item.shopName;
            if (string.IsNullOrEmpty(meta.shopUrl)) meta.shopUrl = item.shopUrl;
            if (string.IsNullOrEmpty(meta.itemThumbUrl) && (item.thumbnail ?? "").StartsWith("http")) meta.itemThumbUrl = BimNet.BigItemThumb(item.thumbnail);
            BimNet.EnsureThumbs(meta);
            return meta;
        }
    }
}
