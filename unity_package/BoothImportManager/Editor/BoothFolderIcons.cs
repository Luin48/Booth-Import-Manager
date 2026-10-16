using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace BoothImportManager
{
    /// <summary>
    /// 프로젝트 창의 폴더 아이콘을 BOOTH 썸네일로 바꿔 그린다.
    /// - 샵 폴더 → 샵 프로필 사진, 에셋 폴더 → 상품 썸네일
    /// - 폴더 GUID 기준으로 기억하므로 폴더를 옮기거나 이름을 바꿔도 유지된다.
    /// - 기록/이미지는 UserSettings/BoothImportManager 에 (프로젝트 에셋을 건드리지 않음)
    /// </summary>
    [InitializeOnLoad]
    public static class BoothFolderIcons
    {
        private const string Dir = "UserSettings/BoothImportManager";
        private const string MapFile = Dir + "/FolderIcons.json";
        private const string IconDir = Dir + "/Icons";
        private const string EnabledKey = "BoothImportManager.FolderIcons.Enabled";

        [Serializable]
        public class Entry
        {
            public string guid;
            public string kind;      // "shop" | "item"
            public string image;     // UserSettings/... 상대 경로
            public string itemId;
            public string title;     // 툴팁용 (샵 이름 / 상품 이름)
            public string url;
        }

        [Serializable]
        private class MapData
        {
            public List<Entry> entries = new List<Entry>();
        }

        [Serializable]
        public class BoothMeta
        {
            public string itemId;
            public string itemName;
            public string itemUrl;
            public string shopName;
            public string shopUrl;
            public string itemThumb;
            public string shopIcon;
            public string fileLabel;
            public string packageName;
        }

        private static Dictionary<string, Entry> map;
        private static readonly Dictionary<string, Texture2D> Textures = new Dictionary<string, Texture2D>();

        public static bool Enabled
        {
            get => EditorPrefs.GetBool(EnabledKey, true);
            set
            {
                EditorPrefs.SetBool(EnabledKey, value);
                EditorApplication.RepaintProjectWindow();
            }
        }

        static BoothFolderIcons()
        {
            EditorApplication.projectWindowItemOnGUI += OnProjectItemGUI;
        }

        // ---- 저장 ----------------------------------------------------------
        private static Dictionary<string, Entry> Map
        {
            get
            {
                if (map != null) return map;
                map = new Dictionary<string, Entry>();
                try
                {
                    if (File.Exists(MapFile))
                    {
                        var data = JsonUtility.FromJson<MapData>(File.ReadAllText(MapFile, Encoding.UTF8));
                        foreach (var e in data?.entries ?? new List<Entry>())
                            if (!string.IsNullOrEmpty(e.guid)) map[e.guid] = e;
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[BoothImportManager] Folder icon map read failed: {e.Message}");
                }
                return map;
            }
        }

        private static void Save()
        {
            Directory.CreateDirectory(Dir);
            var data = new MapData { entries = Map.Values.ToList() };
            File.WriteAllText(MapFile, JsonUtility.ToJson(data, true), Encoding.UTF8);
        }

        public static int Count => Map.Count;

        private static string CopyImage(string source, string name)
        {
            if (string.IsNullOrEmpty(source) || !File.Exists(source)) return "";
            Directory.CreateDirectory(IconDir);
            var target = $"{IconDir}/{name}{Path.GetExtension(source)}";
            try
            {
                File.Copy(source, target, true);
                Textures.Remove(target);
                return target;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BoothImportManager] Icon copy failed: {e.Message}");
                return "";
            }
        }

        public static void Assign(string folderAssetPath, string kind, string imageSource, BoothMeta meta)
        {
            if (!AssetDatabase.IsValidFolder(folderAssetPath)) return;
            var guid = AssetDatabase.AssetPathToGUID(folderAssetPath);
            if (string.IsNullOrEmpty(guid)) return;
            var key = kind == "shop" ? "shop_" + SafeKey(meta.shopName) : "item_" + meta.itemId;
            var image = CopyImage(imageSource, key);
            if (string.IsNullOrEmpty(image)) return;
            Map[guid] = new Entry
            {
                guid = guid,
                kind = kind,
                image = image,
                itemId = meta.itemId,
                title = kind == "shop" ? meta.shopName : meta.itemName,
                url = kind == "shop" ? meta.shopUrl : meta.itemUrl,
            };
            Save();
            EditorApplication.RepaintProjectWindow();
        }

        public static void Remove(string folderAssetPath)
        {
            var guid = AssetDatabase.AssetPathToGUID(folderAssetPath);
            if (Map.Remove(guid))
            {
                Save();
                EditorApplication.RepaintProjectWindow();
            }
        }

        private static string SafeKey(string s)
        {
            var cleaned = Regex.Replace(s ?? "shop", @"[^\w\-]", "_");
            return cleaned.Length > 40 ? cleaned.Substring(0, 40) : cleaned;
        }

        // ---- 그리기 --------------------------------------------------------
        private static Texture2D Load(string path)
        {
            if (Textures.TryGetValue(path, out var tex) && tex != null) return tex;
            if (!File.Exists(path)) return null;
            tex = new Texture2D(2, 2, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave };
            if (!tex.LoadImage(File.ReadAllBytes(path)))
            {
                UnityEngine.Object.DestroyImmediate(tex);
                return null;
            }
            tex.wrapMode = TextureWrapMode.Clamp;
            Textures[path] = tex;
            return tex;
        }

        private static void OnProjectItemGUI(string guid, Rect rect)
        {
            if (!Enabled || Event.current.type != EventType.Repaint) return;
            if (!Map.TryGetValue(guid, out var entry)) return;
            var tex = Load(entry.image);
            if (tex == null) return;

            Rect iconRect;
            var grid = rect.height > 20f;
            if (grid)
            {
                // 그리드(큰 아이콘) 보기: 위쪽 정사각형이 아이콘 영역
                var size = Mathf.Min(rect.width, rect.height - 14f);
                iconRect = new Rect(rect.x + (rect.width - size) / 2f, rect.y, size, size);
            }
            else
            {
                // 리스트/트리 보기: 왼쪽 16px
                iconRect = new Rect(rect.x, rect.y, rect.height, rect.height);
            }

            var bg = EditorGUIUtility.isProSkin ? new Color(0.22f, 0.22f, 0.22f) : new Color(0.76f, 0.76f, 0.76f);
            if (Selection.assetGUIDs.Contains(guid)) bg = EditorGUIUtility.isProSkin ? new Color(0.17f, 0.36f, 0.53f) : new Color(0.23f, 0.45f, 0.69f);
            EditorGUI.DrawRect(iconRect, bg);
            var inner = grid ? new Rect(iconRect.x + 2, iconRect.y + 2, iconRect.width - 4, iconRect.height - 4) : iconRect;
            GUI.DrawTexture(inner, tex, ScaleMode.ScaleAndCrop);

            // 폴더라는 걸 알 수 있게 작은 표시
            if (grid && inner.width >= 40f)
            {
                var badge = new Rect(inner.xMax - 16f, inner.yMax - 16f, 16f, 16f);
                var folderIcon = EditorGUIUtility.IconContent("Folder Icon").image;
                if (folderIcon != null) GUI.DrawTexture(badge, folderIcon, ScaleMode.ScaleToFit);
            }
            else if (!grid && entry.kind == "shop")
            {
                EditorGUI.DrawRect(new Rect(iconRect.xMax - 3f, iconRect.y, 3f, 3f), new Color(0.3f, 0.72f, 0.87f));
            }
        }

        // ---- 임포트 후 자동 지정 --------------------------------------------
        public static BoothMeta ReadSidecar(string packagePath)
        {
            try
            {
                var file = packagePath + ".booth.json";
                if (!File.Exists(file)) return null;
                var meta = JsonUtility.FromJson<BoothMeta>(File.ReadAllText(file, Encoding.UTF8));
                return string.IsNullOrEmpty(meta?.itemId) ? null : meta;
            }
            catch
            {
                return null;
            }
        }

        private static string Norm(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new StringBuilder();
            foreach (var ch in s.ToLowerInvariant())
                if (char.IsLetterOrDigit(ch)) sb.Append(ch);
            return sb.ToString();
        }

        private static bool Similar(string a, string b)
        {
            var x = Norm(a);
            var y = Norm(b);
            if (x.Length < 3 || y.Length < 3) return false;
            return x.Contains(y) || y.Contains(x);
        }

        /// <summary>
        /// 패키지 경로 목록으로 샵 폴더/에셋 폴더를 정한다.
        /// 보통 Assets/샵이름/에셋이름/... 구조라서
        ///  1) 최상위가 샵 이름과 비슷하면 → 샵, 그 아래 상품명과 비슷한(또는 유일한) 폴더 → 에셋
        ///  2) 최상위가 상품명과 비슷하면 → 에셋
        ///  3) 최상위 아래 폴더가 하나뿐이면 → 샵/에셋 구조로 본다
        ///  4) 그 외 → 최상위 = 에셋
        /// </summary>
        public static List<(string relPath, string kind)> Decide(IEnumerable<string> packagePaths, BoothMeta meta)
        {
            var result = new List<(string, string)>();
            var rel = packagePaths
                .Where(p => p.StartsWith("Assets/"))
                .Select(p => p.Substring("Assets/".Length).Split('/'))
                .Where(parts => parts.Length >= 2) // 폴더 안에 든 것만
                .ToList();
            var itemNames = new[] { meta.itemName, meta.fileLabel, meta.packageName }.Where(n => !string.IsNullOrEmpty(n)).ToArray();
            bool LikeItem(string n) => itemNames.Any(i => Similar(n, i));

            foreach (var group in rel.GroupBy(parts => parts[0]))
            {
                var root = group.Key;
                var children = group.Where(p => p.Length >= 3).Select(p => p[1]).Distinct().ToList();
                var filesInRoot = group.Any(p => p.Length == 2 && !children.Contains(p[1]));

                if (Similar(root, meta.shopName) || children.Any(LikeItem) && !LikeItem(root))
                {
                    result.Add((root, "shop"));
                    var assets = children.Where(LikeItem).ToList();
                    if (assets.Count == 0 && children.Count == 1) assets = children;
                    foreach (var c in assets) result.Add(($"{root}/{c}", "item"));
                }
                else if (LikeItem(root))
                {
                    result.Add((root, "item"));
                }
                else if (children.Count == 1 && !filesInRoot)
                {
                    result.Add((root, "shop"));
                    result.Add(($"{root}/{children[0]}", "item"));
                }
                else
                {
                    result.Add((root, "item"));
                }
            }
            return result;
        }

        public static void ApplyAfterImport(BoothMeta meta, IEnumerable<string> packagePaths, Func<string, string> resolveImportedRoot)
        {
            if (meta == null) return;
            foreach (var (relPath, kind) in Decide(packagePaths, meta))
            {
                var parts = relPath.Split('/');
                var rootFinal = resolveImportedRoot(parts[0]);
                if (string.IsNullOrEmpty(rootFinal)) continue;
                var folder = parts.Length > 1 ? $"{rootFinal}/{string.Join("/", parts.Skip(1))}" : rootFinal;
                if (!AssetDatabase.IsValidFolder(folder)) continue;
                Assign(folder, kind, kind == "shop" ? meta.shopIcon : meta.itemThumb, meta);
                Debug.Log($"[BoothImportManager] Folder icon ({kind}): {folder}");
            }
        }

        // ---- 메뉴 ----------------------------------------------------------
        private static string SelectedFolder()
        {
            var obj = Selection.activeObject;
            if (obj == null) return null;
            var path = AssetDatabase.GetAssetPath(obj);
            return AssetDatabase.IsValidFolder(path) ? path : null;
        }

        [MenuItem("Assets/Booth Import Manager/부스 상품 연결 (썸네일 아이콘)…", false, 2000)]
        private static void LinkMenu() => BoothLinkWindow.Open(SelectedFolder());

        [MenuItem("Assets/Booth Import Manager/부스 상품 연결 (썸네일 아이콘)…", true)]
        private static bool LinkMenuValidate() => SelectedFolder() != null;

        [MenuItem("Assets/Booth Import Manager/폴더 아이콘 지우기", false, 2001)]
        private static void RemoveMenu()
        {
            foreach (var guid in Selection.assetGUIDs)
                Remove(AssetDatabase.GUIDToAssetPath(guid));
        }

        [MenuItem("Assets/Booth Import Manager/부스 페이지 열기", false, 2002)]
        private static void OpenPage()
        {
            var guid = Selection.assetGUIDs.FirstOrDefault();
            if (guid != null && Map.TryGetValue(guid, out var e) && !string.IsNullOrEmpty(e.url)) Application.OpenURL(e.url);
        }

        [MenuItem("Assets/Booth Import Manager/부스 페이지 열기", true)]
        private static bool OpenPageValidate()
        {
            var guid = Selection.assetGUIDs.FirstOrDefault();
            return guid != null && Map.TryGetValue(guid, out var e) && !string.IsNullOrEmpty(e.url);
        }

        // ---- 수동 연결: 로컬 앱에 상품 URL 을 넘겨 이미지를 받아온다 --------------
        public static void LinkFromBooth(string folder, string itemUrlOrId, bool parentIsShop, Action<string> done)
        {
            var port = BoothImportSettings.instance.LocalAppPort;
            var body = Encoding.UTF8.GetBytes(JsonUtility.ToJson(new LinkRequest { item = itemUrlOrId }));
            var req = new UnityWebRequest($"http://127.0.0.1:{port}/api/booth/icons", "POST")
            {
                uploadHandler = new UploadHandlerRaw(body),
                downloadHandler = new DownloadHandlerBuffer(),
                timeout = 30,
            };
            req.SetRequestHeader("Content-Type", "application/json");
            var op = req.SendWebRequest();
            op.completed += _ =>
            {
                try
                {
                    if (req.result != UnityWebRequest.Result.Success)
                    {
                        done($"실패: {req.error} (로컬 앱이 켜져 있는지 확인)");
                        return;
                    }
                    var meta = JsonUtility.FromJson<BoothMeta>(req.downloadHandler.text);
                    if (string.IsNullOrEmpty(meta?.itemThumb))
                    {
                        done("썸네일을 받지 못했어요");
                        return;
                    }
                    Assign(folder, "item", meta.itemThumb, meta);
                    var parent = Path.GetDirectoryName(folder)?.Replace('\\', '/');
                    if (parentIsShop && !string.IsNullOrEmpty(parent) && parent != "Assets" && !string.IsNullOrEmpty(meta.shopIcon))
                        Assign(parent, "shop", meta.shopIcon, meta);
                    done($"연결됨: {meta.itemName}");
                }
                finally
                {
                    req.Dispose();
                }
            };
        }

        [Serializable]
        private class LinkRequest
        {
            public string item;
        }
    }

    public class BoothLinkWindow : EditorWindow
    {
        private string folder;
        private string input = "";
        private bool parentIsShop = true;
        private string status = "";

        public static void Open(string folder)
        {
            if (string.IsNullOrEmpty(folder)) return;
            var w = CreateInstance<BoothLinkWindow>();
            w.folder = folder;
            w.titleContent = new GUIContent("부스 상품 연결");
            w.minSize = new Vector2(420, 130);
            w.maxSize = new Vector2(800, 130);
            w.ShowUtility();
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField("폴더", folder);
            input = EditorGUILayout.TextField("상품 URL 또는 번호", input);
            parentIsShop = EditorGUILayout.Toggle(new GUIContent("상위 폴더 = 샵 폴더", "상위 폴더에 샵 프로필 사진도 붙입니다"), parentIsShop);
            EditorGUILayout.BeginHorizontal();
            GUI.enabled = !string.IsNullOrWhiteSpace(input);
            if (GUILayout.Button("연결"))
            {
                status = "받는 중…";
                BoothFolderIcons.LinkFromBooth(folder, input.Trim(), parentIsShop, msg =>
                {
                    status = msg;
                    Repaint();
                });
            }
            GUI.enabled = true;
            if (GUILayout.Button("닫기", GUILayout.Width(80))) Close();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.LabelField(status, EditorStyles.miniLabel);
        }
    }
}
