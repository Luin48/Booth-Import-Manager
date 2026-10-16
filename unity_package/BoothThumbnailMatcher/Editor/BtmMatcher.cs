using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using BoothImportManager;
using UnityEditor;

namespace BoothThumbnailMatcher
{
    /// <summary>
    /// Assets 폴더 트리 ↔ BOOTH 라이브러리 대조.
    ///
    /// 1) 원본 파일 대조 (확실): 원본 .unitypackage/.zip 의 GUID 가 프로젝트에 있으면, 그 폴더가 어디로 옮겨졌든 찾는다.
    /// 2) 이름 대조: 위에서부터 내려가며
    ///    - 분류 폴더(01.헤어 같은)는 건너뛰고 그 아래를 본다
    ///    - 샵 이름과 같은 폴더 → 샵 폴더, 그 아래는 그 샵의 상품 위주로 비교
    ///    - 상품 이름/파일 이름과 비슷한 폴더 → 상품 폴더 (그 아래 Prefab/Materials 같은 폴더는 더 보지 않음)
    /// 점수가 높고 2등과 차이가 크면 자동, 애매하면 후보를 보여주고 고르게 한다.
    /// </summary>
    public static class BtmMatcher
    {
        public enum Status { Auto, Review, None }

        public class Node
        {
            public string path;
            public string name;
            public string guid;
            public int depth;
            public Node parent;
            public readonly List<Node> children = new List<Node>();
            public List<BtmText.Pre> pres;     // 폴더 이름 후보 (앞 번호·버전 뗀 것 포함)
            public bool generic;
            public bool hasIcon;
            public bool category;
        }

        public class Candidate
        {
            public BtmLibrary.Item item;
            public double score;
            public string reason;
        }

        public class Result
        {
            public Node folder;
            public string kind = "item";          // item | shop
            public Status status;
            public string source = "name";        // guid | name | children
            public readonly List<Candidate> candidates = new List<Candidate>();
            public Candidate chosen;              // 자동으로 고른 것 / 사용자가 고른 것
            public bool selected;                 // 적용 체크
            public bool hidden;

            public string Path => folder.path;
            public double Score => chosen?.score ?? (candidates.Count > 0 ? candidates[0].score : 0);
        }

        public class Output
        {
            public readonly List<Result> results = new List<Result>();
            public readonly List<Node> existing = new List<Node>();
            public int folderCount;
            public int packageFiles;
            public int packagesMatched;
            public int packagesUnknown;
        }

        // ---- 기준값 ----------------------------------------------------------------
        public const double AutoScore = 0.9;
        public const double AutoMargin = 0.12;
        public const double ShopScore = 0.85;
        public const double ReviewScore = 0.55;
        public const double ShowScore = 0.35;
        private const int MaxCandidates = 6;
        private const int MaxDepth = 8;

        // ---- 폴더 트리 --------------------------------------------------------------
        public static Node BuildTree(Func<string, bool> isHidden, out int count)
        {
            var root = new Node { path = "Assets", name = "Assets", guid = AssetDatabase.AssetPathToGUID("Assets"), depth = 0 };
            var n = 0;
            var stack = new Stack<Node>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                var node = stack.Pop();
                if (node.depth >= MaxDepth) continue;
                foreach (var sub in AssetDatabase.GetSubFolders(node.path))
                {
                    var name = System.IO.Path.GetFileName(sub);
                    var child = new Node
                    {
                        path = sub,
                        name = name,
                        guid = AssetDatabase.AssetPathToGUID(sub),
                        depth = node.depth + 1,
                        parent = node,
                        pres = BtmText.FolderVariants(name),
                        generic = BtmText.IsGeneric(name),
                    };
                    child.hasIcon = BoothFolderIcons.HasIcon(child.guid);
                    if (isHidden != null && isHidden(child.guid)) continue;
                    node.children.Add(child);
                    n++;
                    stack.Push(child);
                }
                node.children.Sort((a, b) => string.Compare(a.name, b.name, StringComparison.OrdinalIgnoreCase));
            }
            count = n;
            return root;
        }

        private static IEnumerable<Node> Walk(Node node)
        {
            yield return node;
            foreach (var c in node.children)
                foreach (var d in Walk(c))
                    yield return d;
        }

        // ---- 전체 실행 ----------------------------------------------------------------
        public static Output Run(Node root, int folderCount, List<BtmPackages.Record> records, Func<string, bool> isCategoryOverride)
        {
            var output = new Output { folderCount = folderCount };
            var items = BtmLibrary.Items;
            var shops = items.GroupBy(i => i.shopKey).Where(g => !string.IsNullOrEmpty(g.Key)).Select(g => g.First()).ToList();
            var byPath = new Dictionary<string, Result>();

            // 1) 원본 파일 대조
            if (records != null) GuidPass(records, byPath, output);

            // 2) 이름 대조
            var ctx = new Ctx { items = items, shops = shops, byPath = byPath, categoryOverride = isCategoryOverride };
            foreach (var c in root.children) Visit(c, null, ctx);

            foreach (var node in Walk(root))
                if (node.hasIcon && node != root) output.existing.Add(node);

            output.results.AddRange(byPath.Values.Where(r => !r.folder.hasIcon));
            output.results.AddRange(ctx.unmatched.Where(n => !byPath.ContainsKey(n.path) && !n.hasIcon).Select(n => new Result { folder = n, status = Status.None, source = "" }));
            foreach (var r in output.results)
            {
                if (r.status == Status.Auto) r.selected = true;
            }
            output.results.Sort((a, b) => string.Compare(a.Path, b.Path, StringComparison.OrdinalIgnoreCase));
            return output;
        }

        private class Ctx
        {
            public List<BtmLibrary.Item> items;
            public List<BtmLibrary.Item> shops;
            public Dictionary<string, Result> byPath;
            public readonly List<Node> unmatched = new List<Node>();
            public Func<string, bool> categoryOverride;
        }

        // ---- 1) 원본 파일 ---------------------------------------------------------------
        private static void GuidPass(List<BtmPackages.Record> records, Dictionary<string, Result> byPath, Output output)
        {
            var archived = BtmPackages.ArchivedItems();
            foreach (var rec in records)
            {
                if (rec.packages == null || rec.packages.Count == 0) continue;
                output.packageFiles++;
                var itemId = BtmPackages.ItemIdFor(rec.path, archived);
                if (string.IsNullOrEmpty(itemId) || !BtmLibrary.ById.TryGetValue(itemId, out var item))
                {
                    output.packagesUnknown++;
                    continue;
                }
                var any = false;
                foreach (var pkg in rec.packages)
                {
                    var all = pkg.folders.Concat(pkg.files).ToList();
                    var present = all.Count(e => !string.IsNullOrEmpty(AssetDatabase.GUIDToAssetPath(e.g)));
                    if (present == 0) continue;
                    var meta = new BoothFolderIcons.BoothMeta
                    {
                        itemId = item.itemId,
                        itemName = item.name,
                        shopName = item.shopName,
                        fileLabel = System.IO.Path.GetFileName(rec.path),
                        packageName = System.IO.Path.GetFileName(pkg.inner),
                    };
                    foreach (var (rel, kind) in BoothFolderIcons.Decide(all.Select(e => e.p), meta))
                    {
                        var actual = Locate("Assets/" + rel, pkg);
                        if (string.IsNullOrEmpty(actual) || actual == "Assets" || !AssetDatabase.IsValidFolder(actual)) continue;
                        AddGuidResult(byPath, actual, kind, item, $"원본 파일 ({System.IO.Path.GetFileName(rec.path)})");
                        any = true;
                    }
                }
                if (any) output.packagesMatched++;
            }
        }

        /// <summary>패키지 안의 원래 폴더 경로가 지금 프로젝트의 어디에 있는지</summary>
        private static string Locate(string original, BtmPackages.Pkg pkg)
        {
            var folder = pkg.folders.FirstOrDefault(e => e.p == original);
            if (folder != null)
            {
                var p = AssetDatabase.GUIDToAssetPath(folder.g);
                if (!string.IsNullOrEmpty(p) && AssetDatabase.IsValidFolder(p)) return p;
            }
            // 폴더 항목이 없으면: 안에 든 파일 위치에서 거꾸로 계산 (다수결)
            var votes = new Dictionary<string, int>();
            var prefix = original + "/";
            foreach (var e in pkg.files.Concat(pkg.folders))
            {
                if (!e.p.StartsWith(prefix)) continue;
                var actual = AssetDatabase.GUIDToAssetPath(e.g);
                if (string.IsNullOrEmpty(actual)) continue;
                var suffix = e.p.Substring(prefix.Length);
                if (!actual.EndsWith("/" + suffix)) continue;
                var root = actual.Substring(0, actual.Length - suffix.Length - 1);
                votes[root] = votes.TryGetValue(root, out var c) ? c + 1 : 1;
            }
            return votes.Count == 0 ? null : votes.OrderByDescending(kv => kv.Value).First().Key;
        }

        private static void AddGuidResult(Dictionary<string, Result> byPath, string path, string kind, BtmLibrary.Item item, string reason)
        {
            var guid = AssetDatabase.AssetPathToGUID(path);
            if (!byPath.TryGetValue(path, out var r))
            {
                r = new Result
                {
                    folder = new Node { path = path, name = System.IO.Path.GetFileName(path), guid = guid, hasIcon = BoothFolderIcons.HasIcon(guid) },
                    kind = kind,
                    source = "guid",
                    status = Status.Auto,
                };
                byPath[path] = r;
            }
            if (r.candidates.Any(c => c.item.itemId == item.itemId)) return;
            // 샵 폴더는 같은 샵이면 상품이 달라도 같은 결과
            if (kind == "shop" && r.candidates.Any(c => c.item.shopKey == item.shopKey)) return;
            r.candidates.Add(new Candidate { item = item, score = 1, reason = reason });
            r.chosen = r.candidates[0];
            if (r.candidates.Count > 1 && kind == "item") r.status = Status.Review; // 여러 상품이 같은 폴더 → 직접 고르기
        }

        // ---- 2) 이름 ------------------------------------------------------------------
        private static bool IsCategory(Node node, Ctx ctx)
        {
            if (ctx.categoryOverride != null && ctx.categoryOverride(node.guid)) return true;
            var parentIsTop = node.parent == null || node.parent.depth == 0 || node.parent.category;
            if (!parentIsTop) return false;
            var nonGeneric = node.children.Count(c => !c.generic);
            if (nonGeneric < 2) return false;
            var lower = node.name.ToLowerInvariant();
            return BtmText.LooksLikeCategory(node.name) || lower == "booth" || lower == "_booth" || lower == "booth assets";
        }

        private static List<Candidate> ScoreItems(Node node, string shopKey, Ctx ctx)
        {
            var list = new List<Candidate>();
            foreach (var item in ctx.items)
            {
                var s = BtmText.Best(node.pres, item.nameVariants);
                var reason = $"이름 {s * 100:0}%";
                if (s < 0.9)
                {
                    // "!Macro_shop_InkQipao" 처럼 샵 이름 + 상품 이름을 붙인 폴더: 샵 이름을 떼고 다시 비교
                    var compact = node.pres[0].Compact;
                    foreach (var sv in item.shopVariants)
                    {
                        if (sv.Compact.Length < 4) continue;
                        var at = compact.IndexOf(sv.Compact, StringComparison.Ordinal);
                        if (at < 0) continue;
                        var rest = compact.Remove(at, sv.Compact.Length);
                        if (rest.Length < 3) continue;
                        var s2 = BtmText.Best(new BtmText.Pre(rest), item.nameVariants) * 0.98;
                        if (s2 > s)
                        {
                            s = s2;
                            reason = $"샵+상품 이름 {s * 100:0}%";
                        }
                    }
                }
                if (s < 0.2) continue;
                if (shopKey != null)
                {
                    if (item.shopKey == shopKey)
                    {
                        s = Math.Min(1, s + 0.12);
                        reason += " · 같은 샵";
                    }
                    else
                    {
                        s -= 0.15;
                        reason += " · 다른 샵";
                    }
                }
                else if (node.parent != null && node.parent.depth > 0 && !node.parent.category && node.parent.pres != null && BtmText.Best(node.parent.pres, item.shopVariants) >= 0.6)
                {
                    s = Math.Min(1, s + 0.08);
                    reason += " · 상위 폴더=샵";
                }
                if (s >= ShowScore) list.Add(new Candidate { item = item, score = s, reason = reason });
            }
            list.Sort((a, b) => b.score.CompareTo(a.score));
            if (list.Count > MaxCandidates) list.RemoveRange(MaxCandidates, list.Count - MaxCandidates);
            return list;
        }

        private static List<Candidate> ScoreShops(Node node, Ctx ctx)
        {
            var list = new List<Candidate>();
            foreach (var shop in ctx.shops)
            {
                var s = BtmText.Best(node.pres, shop.shopVariants);
                if (s >= ShowScore) list.Add(new Candidate { item = shop, score = s, reason = $"샵 이름 {s * 100:0}%" });
            }
            list.Sort((a, b) => b.score.CompareTo(a.score));
            if (list.Count > MaxCandidates) list.RemoveRange(MaxCandidates, list.Count - MaxCandidates);
            return list;
        }

        private static bool Decisive(List<Candidate> list, double min)
        {
            if (list.Count == 0 || list[0].score < min) return false;
            if (list.Count == 1) return true;
            // 2등이 같은 상품의 다른 이름이면 상관없음
            var second = list.Skip(1).FirstOrDefault(c => c.item.itemId != list[0].item.itemId);
            return second == null || list[0].score - second.score >= AutoMargin;
        }

        /// <summary>폴더 하나를 보고 결과를 정한 뒤, 필요하면 아래로 내려간다. 돌려주는 값: 이 폴더가 자동으로 상품이 됐으면 그 상품</summary>
        /// <param name="free">샵·분류 폴더가 아닌(모르는) 폴더를 몇 단계 지나왔는지. 깊이 들어갈수록 자동 매칭을 아낀다</param>
        private static BtmLibrary.Item Visit(Node node, string shopKey, Ctx ctx, int free = 0)
        {
            if (node.generic) return null;

            // 원본 파일로 이미 정해진 폴더
            if (ctx.byPath.TryGetValue(node.path, out var known))
            {
                known.folder = node;
                if (known.kind == "item") return known.status == Status.Auto ? known.chosen?.item : null;
                var key = known.chosen?.item.shopKey;
                foreach (var c in node.children) Visit(c, key, ctx, 0);
                return null;
            }
            if (node.hasIcon)
            {
                // BIM 이 붙인 아이콘: 샵이면 그 아래를 계속 본다
                var e = BoothFolderIcons.Get(node.guid);
                if (e != null && e.kind == "shop")
                {
                    var any = ctx.items.FirstOrDefault(i => !string.IsNullOrEmpty(e.itemId) && i.itemId == e.itemId);
                    foreach (var c in node.children) Visit(c, any?.shopKey ?? shopKey, ctx, 0);
                }
                return null;
            }

            if (IsCategory(node, ctx))
            {
                node.category = true;
                foreach (var c in node.children) Visit(c, null, ctx, 0);
                return null;
            }

            var itemCands = ScoreItems(node, shopKey, ctx);
            var shopCands = shopKey == null ? ScoreShops(node, ctx) : new List<Candidate>();
            var bestItem = itemCands.Count > 0 ? itemCands[0].score : 0;
            var bestShop = shopCands.Count > 0 ? shopCands[0].score : 0;
            var hasSubs = node.children.Any(c => !c.generic);

            // 샵 폴더
            if (bestShop >= ShopScore && bestShop >= bestItem && hasSubs)
            {
                var r = new Result { folder = node, kind = "shop", source = "name" };
                r.candidates.AddRange(shopCands);
                r.status = Decisive(shopCands, ShopScore) ? Status.Auto : Status.Review;
                if (r.status == Status.Auto) r.chosen = shopCands[0];
                ctx.byPath[node.path] = r;
                var key = shopCands[0].item.shopKey;
                foreach (var c in node.children) Visit(c, key, ctx, 0);
                return null;
            }

            // 상품 폴더
            var autoMin = shopKey != null && itemCands.Count > 0 && itemCands[0].item.shopKey == shopKey ? AutoScore - 0.05 : AutoScore;
            if (bestItem >= ReviewScore && bestItem >= bestShop - 0.05)
            {
                var r = new Result { folder = node, kind = "item", source = "name" };
                r.candidates.AddRange(itemCands);
                // 자동은: 점수 충분 + 2등과 차이 + 샵/분류 바로 아래(또는 한 단계 아래에서 거의 같은 이름) + 샵 안에서는 그 샵 상품만
                var placeOk = free == 0 || free == 1 && itemCands[0].score >= 0.95;
                var shopOk = shopKey == null || itemCands[0].item.shopKey == shopKey;
                r.status = Decisive(itemCands, autoMin) && placeOk && shopOk ? Status.Auto : Status.Review;
                if (r.status == Status.Auto) r.chosen = itemCands[0];
                // 애매한데 아래 폴더가 더 잘 맞을 수 있으면(샵 폴더일 수도) 아래도 본다
                if (r.status == Status.Review && hasSubs && bestItem < 0.75)
                {
                    var childHits = node.children.Select(c => Visit(c, shopKey, ctx, free + 1)).Where(i => i != null).ToList();
                    if (childHits.Count > 0)
                    {
                        // 아래에서 상품이 나왔으면 이 폴더는 샵/묶음 폴더 → 상품 후보에서 뺀다
                        InferShop(node, childHits, shopCands, ctx);
                        return null;
                    }
                }
                ctx.byPath[node.path] = r;
                return r.status == Status.Auto ? r.chosen.item : null;
            }

            // 모르는 폴더: 아래를 보고, 아래에서 같은 샵 상품이 나오면 샵 폴더로 추정
            var hits = new List<BtmLibrary.Item>();
            foreach (var c in node.children)
            {
                var hit = Visit(c, shopKey, ctx, free + 1);
                if (hit != null) hits.Add(hit);
            }
            if (hits.Count > 0)
            {
                InferShop(node, hits, shopCands, ctx);
                return null;
            }
            if (bestShop >= ReviewScore && hasSubs && shopKey == null)
            {
                var r = new Result { folder = node, kind = "shop", source = "name", status = Status.Review };
                r.candidates.AddRange(shopCands);
                ctx.byPath[node.path] = r;
                return null;
            }
            // 매칭할 만한 위치(최상위·분류·샵 바로 아래)면 '못 찾음' 목록에
            var p = node.parent;
            var spot = p == null || p.depth == 0 || p.category || shopKey != null && ctx.byPath.TryGetValue(p.path, out var pr) && pr.kind == "shop";
            if (spot && (hasSubs || node.depth <= 2)) ctx.unmatched.Add(node);
            return null;
        }

        private static void InferShop(Node node, List<BtmLibrary.Item> hits, List<Candidate> shopCands, Ctx ctx)
        {
            if (node.category || node.depth == 0 || ctx.byPath.ContainsKey(node.path)) return;
            var groups = hits.GroupBy(h => h.shopKey).ToList();
            if (groups.Count != 1) return;
            var shop = groups[0].First();
            var nameScore = BtmText.Best(node.pres, shop.shopVariants);
            var count = groups[0].Select(h => h.itemId).Distinct().Count();
            var r = new Result { folder = node, kind = "shop", source = "children" };
            r.candidates.Add(new Candidate { item = shop, score = Math.Max(nameScore, 0.8), reason = $"아래 상품 {count}개가 이 샵" });
            foreach (var c in shopCands)
                if (c.item.shopKey != shop.shopKey) r.candidates.Add(c);
            r.status = count >= 2 || nameScore >= 0.6 ? Status.Auto : Status.Review;
            if (r.status == Status.Auto) r.chosen = r.candidates[0];
            ctx.byPath[node.path] = r;
        }

        // ---- 수동 검색 ----------------------------------------------------------------
        public static List<Candidate> Search(string query, string folderName, int limit = 40)
        {
            var q = BtmText.FolderVariants(string.IsNullOrWhiteSpace(query) ? folderName : query);
            var raw = (query ?? "").Trim();
            var list = new List<Candidate>();
            foreach (var item in BtmLibrary.Items)
            {
                double s;
                if (raw.Length > 0 && (raw == item.itemId || item.name.IndexOf(raw, StringComparison.OrdinalIgnoreCase) >= 0 || item.shopName.IndexOf(raw, StringComparison.OrdinalIgnoreCase) >= 0))
                    s = 1;
                else
                    s = Math.Max(BtmText.Best(q, item.nameVariants), BtmText.Best(q, item.shopVariants) * 0.9);
                if (s >= 0.25 || raw.Length == 0 && list.Count < limit) list.Add(new Candidate { item = item, score = s, reason = "" });
            }
            return list.OrderByDescending(c => c.score).ThenBy(c => c.item.name).Take(limit).ToList();
        }
    }
}
