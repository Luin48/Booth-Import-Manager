using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace BoothImportManager
{
    [InitializeOnLoad]
    public static class BoothPackageImporter
    {
        private const string PendingFile = "Temp/BoothImportManager_pending.json";
        private const string UntaggedTagName = "태그 없음";

        static BoothPackageImporter()
        {
            if (!File.Exists(PendingFile)) return;
            PendingState state = null;
            try { state = JsonUtility.FromJson<PendingState>(File.ReadAllText(PendingFile)); }
            catch { Cleanup(); return; }
            if (state == null || string.IsNullOrEmpty(state.packagePath)) { Cleanup(); return; }

            var frame = 0;
            EditorApplication.update += Wait;
            void Wait()
            {
                if (++frame < 5) return;
                EditorApplication.update -= Wait;
                AfterImport(state);
            }
        }

        public static bool HasPending => File.Exists(PendingFile);

        public static void ImportPackage(string packagePath, string tag, string assetRoot, BoothFolderIcons.BoothMeta meta)
        {
            if (!File.Exists(packagePath))
            {
                BimJobRunner.PackageFinished(false, "파일이 없어요", null);
                return;
            }

            var packagePaths = ReadPackagePathnames(packagePath);
            var expectedFolders = FoldersFromPaths(packagePaths).ToArray();
            var state = new PendingState
            {
                packagePath = packagePath,
                tag = tag,
                assetRoot = assetRoot,
                expectedFolders = expectedFolders,
                packagePaths = packagePaths.ToArray(),
                booth = meta,
            };
            File.WriteAllText(PendingFile, JsonUtility.ToJson(state), Encoding.UTF8);

            var packageName = Path.GetFileNameWithoutExtension(packagePath);
            var finished = false;
            AssetDatabase.importPackageCompleted += OnCompleted;
            AssetDatabase.importPackageFailed += OnFailed;
            ScheduleFallback();
            AssetDatabase.ImportPackage(packagePath, false);

            void OnCompleted(string name)
            {
                if (name != packageName) return;
                Complete();
            }

            void OnFailed(string name, string error)
            {
                if (name != packageName) return;
                finished = true;
                AssetDatabase.importPackageCompleted -= OnCompleted;
                AssetDatabase.importPackageFailed -= OnFailed;
                Debug.LogError($"[BoothImportManager] Import failed: {name} - {error}");
                Cleanup();
                BimJobRunner.PackageFinished(false, error, null);
            }

            void Complete()
            {
                if (finished) return;
                finished = true;
                AssetDatabase.importPackageCompleted -= OnCompleted;
                AssetDatabase.importPackageFailed -= OnFailed;
                AfterImport(state);
            }

            void ScheduleFallback()
            {
                var frames = 0;
                EditorApplication.update += WaitForImport;

                void WaitForImport()
                {
                    if (finished)
                    {
                        EditorApplication.update -= WaitForImport;
                        return;
                    }

                    if (++frames < 20) return;
                    EditorApplication.update -= WaitForImport;
                    if (!File.Exists(PendingFile)) return;

                    Debug.LogWarning($"[BoothImportManager] Import completion fallback: {Path.GetFileName(packagePath)}");
                    Complete();
                }
            }
        }

        private static void AfterImport(PendingState state)
        {
            if (!File.Exists(PendingFile)) return;
            Cleanup();

            var assetRoot = NormalizeAssetPath(string.IsNullOrWhiteSpace(state.assetRoot) ? BoothImportSettings.instance.AssetRootFolder : state.assetRoot);
            var targetRoot = state.tag == UntaggedTagName
                ? assetRoot
                : $"{assetRoot}/{SanitizeFolderName(state.tag)}";
            EnsureFolder(targetRoot);
            AssetDatabase.Refresh();

            var importedRoots = FindImportedRootFolders(state, targetRoot);

            AssetDatabase.StartAssetEditing();
            try
            {
                foreach (var source in importedRoots)
                    MergeIntoTarget(source, $"{targetRoot}/{NormalizeUnityDuplicateName(Path.GetFileName(source))}");
                MergeDuplicateFoldersInTarget(targetRoot);
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }

            AssetDatabase.Refresh();
            AssetDatabase.StartAssetEditing();
            try
            {
                MergeDuplicateFoldersInTarget(targetRoot);
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }

            // 부스 썸네일로 폴더 아이콘 지정 (샵 폴더 / 에셋 폴더)
            if (state.booth != null && !string.IsNullOrEmpty(state.booth.itemId))
            {
                try
                {
                    BoothFolderIcons.ApplyAfterImport(state.booth, state.packagePaths ?? Array.Empty<string>(), rootName =>
                    {
                        var moved = $"{targetRoot}/{NormalizeUnityDuplicateName(rootName)}";
                        if (AssetDatabase.IsValidFolder(moved)) return moved;
                        var original = $"Assets/{rootName}";
                        return AssetDatabase.IsValidFolder(original) ? original : null;
                    });
                }
                catch (Exception e) { Debug.LogWarning($"[BoothImportManager] Folder icon failed: {e.Message}"); }
            }

            AssetDatabase.Refresh();
            ScheduleDelayedDuplicateMerge(assetRoot);
            BimJobRunner.PackageFinished(true, null, targetRoot);
        }

        private static List<string> FindImportedRootFolders(PendingState state, string targetRoot)
        {
            var expectedNames = new HashSet<string>((state.expectedFolders ?? Array.Empty<string>())
                .Select(NormalizeUnityDuplicateName)
                .Where(name => !string.IsNullOrEmpty(name)));
            var roots = new List<string>();

            foreach (var directory in Directory.GetDirectories(Application.dataPath))
            {
                var folderName = Path.GetFileName(directory);
                var normalized = NormalizeUnityDuplicateName(folderName);
                var assetPath = $"Assets/{folderName}";
                if (!expectedNames.Contains(normalized)) continue;
                if (assetPath == targetRoot || assetPath.StartsWith(targetRoot + "/")) continue;
                if (AssetDatabase.IsValidFolder(assetPath))
                    roots.Add(assetPath);
            }

            if (AssetDatabase.IsValidFolder(targetRoot))
            {
                foreach (var directory in Directory.GetDirectories(ToAbsPath(targetRoot)))
                {
                    var folderName = Path.GetFileName(directory);
                    var normalized = NormalizeUnityDuplicateName(folderName);
                    var assetPath = ToAssetPath(directory);
                    if (!expectedNames.Contains(normalized)) continue;
                    if (!IsUnityDuplicateName(folderName)) continue;
                    if (AssetDatabase.IsValidFolder(assetPath))
                        roots.Add(assetPath);
                }
            }

            return roots
                .Distinct()
                .OrderBy(path => NormalizeUnityDuplicateName(Path.GetFileName(path)))
                .ThenByDescending(path => Path.GetFileName(path) != NormalizeUnityDuplicateName(Path.GetFileName(path)))
                .ThenBy(path => path)
                .ToList();
        }

        private static void MergeDuplicateFoldersInTarget(string targetRoot)
        {
            if (!AssetDatabase.IsValidFolder(targetRoot)) return;

            var changed = true;
            while (changed)
            {
                changed = false;
                var duplicates = Directory.GetDirectories(ToAbsPath(targetRoot), "*", SearchOption.AllDirectories)
                    .Select(ToAssetPath)
                    .Where(AssetDatabase.IsValidFolder)
                    .Where(path => IsUnityDuplicateName(Path.GetFileName(path)))
                    .OrderBy(path => path.Count(ch => ch == '/'))
                    .ToList();

                foreach (var source in duplicates)
                {
                    if (!AssetDatabase.IsValidFolder(source)) continue;
                    var folderName = Path.GetFileName(source);
                    var normalized = NormalizeUnityDuplicateName(folderName);

                    var target = $"{ParentPath(source)}/{normalized}";
                    if (source == target || !AssetDatabase.IsValidFolder(target)) continue;

                    Debug.Log($"[BoothImportManager] Merge duplicate folder: {source} -> {target}");
                    MergeIntoTarget(source, target);
                    changed = true;
                    break;
                }
            }
        }

        private static void ScheduleDelayedDuplicateMerge(string root)
        {
            var frames = 0;
            EditorApplication.update += WaitAndMerge;

            void WaitAndMerge()
            {
                if (++frames < 10) return;
                EditorApplication.update -= WaitAndMerge;

                AssetDatabase.Refresh();
                AssetDatabase.StartAssetEditing();
                try
                {
                    MergeDuplicateFoldersInTarget(root);
                }
                finally
                {
                    AssetDatabase.StopAssetEditing();
                }
                AssetDatabase.Refresh();
            }
        }

        private static void MergeIntoTarget(string source, string target)
        {
            if (!AssetDatabase.IsValidFolder(target))
            {
                EnsureFolder(ParentPath(target));
                var error = AssetDatabase.MoveAsset(source, target);
                if (!string.IsNullOrEmpty(error))
                    Debug.LogWarning($"[BoothImportManager] Move failed: {source} -> {target}: {error}");
                return;
            }

            foreach (var child in Directory.GetFileSystemEntries(ToAbsPath(source)))
            {
                if (child.EndsWith(".meta", StringComparison.OrdinalIgnoreCase)) continue;
                var childAssetPath = ToAssetPath(child);
                var childTarget = $"{target}/{Path.GetFileName(child)}";
                if (Directory.Exists(child))
                    MergeIntoTarget(childAssetPath, childTarget);
                else
                    MoveFileMerging(childAssetPath, childTarget);
            }

            if (AssetDatabase.IsValidFolder(source))
                AssetDatabase.DeleteAsset(source);
        }

        private static void MoveFileMerging(string source, string target)
        {
            var finalTarget = target;
            if (File.Exists(ToAbsPath(finalTarget)))
                finalTarget = AssetDatabase.GenerateUniqueAssetPath(target);
            var error = AssetDatabase.MoveAsset(source, finalTarget);
            if (!string.IsNullOrEmpty(error))
                Debug.LogWarning($"[BoothImportManager] File move failed: {source} -> {finalTarget}: {error}");
        }

        private static IEnumerable<string> FoldersFromPaths(IEnumerable<string> paths)
        {
            var folderNames = new HashSet<string>();
            foreach (var assetPath in paths)
            {
                if (!assetPath.StartsWith("Assets/")) continue;
                foreach (var part in assetPath.Substring("Assets/".Length).Split('/'))
                    if (!string.IsNullOrEmpty(part))
                        folderNames.Add(part);
            }
            return folderNames;
        }

        private static List<string> ReadPackagePathnames(string packagePath)
        {
            var paths = new List<string>();
            try
            {
                using var fs = File.OpenRead(packagePath);
                using var gz = new GZipStream(fs, CompressionMode.Decompress);
                var header = new byte[512];
                while (true)
                {
                    if (!ReadFully(gz, header, 512)) break;
                    if (header[0] == 0) break;

                    var entryName = Encoding.ASCII.GetString(header, 0, 100).TrimEnd('\0');
                    var sizeOctal = Encoding.ASCII.GetString(header, 124, 12).Trim('\0', ' ');
                    var size = string.IsNullOrWhiteSpace(sizeOctal) ? 0 : Convert.ToInt64(sizeOctal.Trim(), 8);

                    if (entryName.EndsWith("/pathname") && size > 0 && size < 4096)
                    {
                        var content = new byte[size];
                        ReadFully(gz, content, (int)size);
                        var assetPath = Encoding.UTF8.GetString(content).Split('\n')[0].Trim('\0', '\r', ' ');
                        if (assetPath.StartsWith("Assets/"))
                            paths.Add(assetPath);
                        SkipPadding(gz, size);
                    }
                    else
                    {
                        SkipContent(gz, size);
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BoothImportManager] Package scan failed: {e.Message}");
            }
            return paths;
        }

        private static bool ReadFully(Stream stream, byte[] buffer, int count)
        {
            var offset = 0;
            while (offset < count)
            {
                var read = stream.Read(buffer, offset, count - offset);
                if (read == 0) return offset > 0;
                offset += read;
            }
            return true;
        }

        private static void SkipPadding(Stream stream, long size)
        {
            var remainder = size % 512;
            if (remainder <= 0) return;
            var skip = new byte[512 - remainder];
            ReadFully(stream, skip, skip.Length);
        }

        private static void SkipContent(Stream stream, long size)
        {
            var total = size + (512 - size % 512) % 512;
            var buffer = new byte[65536];
            while (total > 0)
            {
                var read = stream.Read(buffer, 0, (int)Math.Min(total, buffer.Length));
                if (read == 0) break;
                total -= read;
            }
        }

        // ---- unitypackage 가 없는 상품 (텍스쳐·머티리얼만 든 zip, 이미지 단일 파일 등) ----------
        private static readonly HashSet<string> SkipFileNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".DS_Store", "Thumbs.db", "desktop.ini" };
        private static readonly HashSet<string> SkipExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".blend", ".blend1", ".zip", ".rar", ".7z", ".exe", ".lnk", ".url", ".unitypackage",
        };

        /// <summary>유니티에 넣을 파일인지 (맥 찌꺼기, 블렌더 원본(블렌더 없으면 오류), 압축·실행 파일 제외)</summary>
        public static bool IsLooseFile(string path)
        {
            var p = (path ?? "").Replace('\\', '/');
            if (p.Split('/').Any(part => part == "__MACOSX" || part.StartsWith("._"))) return false;
            var name = Path.GetFileName(p);
            if (string.IsNullOrEmpty(name) || SkipFileNames.Contains(name)) return false;
            return !SkipExtensions.Contains(Path.GetExtension(name));
        }

        /// <summary>
        /// unitypackage 가 없는 상품: [에셋 루트]/[태그]/[샵 이름]/[상품 이름] 폴더를 만들어 파일을 그대로 넣는다.
        /// baseDir 기준 하위 폴더 구조는 유지하고, 같이 든 .meta 도 복사해서 GUID(머티리얼 → 텍스쳐 연결)를 지킨다.
        /// 같은 샵 사진이 붙은 샵 폴더가 이미 태그 폴더에 있으면 그 폴더를 쓴다. 돌려주는 값: 상품 폴더 경로
        /// </summary>
        public static string ImportLooseFiles(string baseDir, IList<string> files, string tag, string assetRoot, BoothFolderIcons.BoothMeta meta)
        {
            var root = NormalizeAssetPath(string.IsNullOrWhiteSpace(assetRoot) ? BoothImportSettings.instance.AssetRootFolder : assetRoot);
            var targetRoot = string.IsNullOrWhiteSpace(tag) || tag == UntaggedTagName ? root : $"{root}/{SanitizeFolderName(tag)}";
            EnsureFolder(targetRoot);

            var item = CleanFolderName(meta?.itemName);
            if (string.IsNullOrEmpty(item)) item = CleanFolderName(meta?.packageName);
            if (string.IsNullOrEmpty(item)) item = "미분류";
            var shopFolder = FindShopFolder(targetRoot, meta);
            if (shopFolder == null)
            {
                var shop = CleanFolderName(meta?.shopName);
                if (!string.IsNullOrEmpty(shop)) shopFolder = $"{targetRoot}/{shop}";
            }
            var itemFolder = $"{shopFolder ?? targetRoot}/{item}";
            EnsureFolder(itemFolder);

            var destAbs = ToAbsPath(itemFolder);
            var baseFull = Path.GetFullPath(baseDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            foreach (var file in files)
            {
                var full = Path.GetFullPath(file);
                var rel = full.StartsWith(baseFull, StringComparison.OrdinalIgnoreCase) ? full.Substring(baseFull.Length) : Path.GetFileName(full);
                var target = Path.Combine(destAbs, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(target) ?? destAbs);
                File.Copy(full, target, true);
                var meta_ = full + ".meta";
                if (File.Exists(meta_) && !File.Exists(target + ".meta")) File.Copy(meta_, target + ".meta");
            }
            AssetDatabase.Refresh();

            if (meta != null && !string.IsNullOrEmpty(meta.itemId))
            {
                try
                {
                    if (!string.IsNullOrEmpty(meta.itemThumb)) BoothFolderIcons.Assign(itemFolder, "item", meta.itemThumb, meta);
                    if (shopFolder != null && !string.IsNullOrEmpty(meta.shopIcon) && !BoothFolderIcons.HasIcon(AssetDatabase.AssetPathToGUID(shopFolder)))
                        BoothFolderIcons.Assign(shopFolder, "shop", meta.shopIcon, meta);
                }
                catch (Exception e) { Debug.LogWarning($"[BoothImportManager] Folder icon failed: {e.Message}"); }
            }
            return itemFolder;
        }

        /// <summary>태그 폴더 바로 아래에 같은 샵 사진이 붙은 폴더가 있으면 (예: unitypackage 가 만든 "#ShopName")</summary>
        private static string FindShopFolder(string targetRoot, BoothFolderIcons.BoothMeta meta)
        {
            if (meta == null || string.IsNullOrEmpty(meta.shopName) && string.IsNullOrEmpty(meta.shopUrl)) return null;
            foreach (var e in BoothFolderIcons.All())
            {
                if (e.kind != "shop") continue;
                var same = !string.IsNullOrEmpty(meta.shopUrl) && string.Equals(e.url?.TrimEnd('/'), meta.shopUrl.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)
                           || !string.IsNullOrEmpty(meta.shopName) && e.title == meta.shopName;
                if (!same) continue;
                var path = AssetDatabase.GUIDToAssetPath(e.guid);
                if (!string.IsNullOrEmpty(path) && ParentPath(path) == targetRoot && AssetDatabase.IsValidFolder(path)) return path;
            }
            return null;
        }

        /// <summary>폴더 이름용: 【8アバター対応】 같은 꾸밈 괄호 떼고, 못 쓰는 글자 바꾸고, 너무 길면 자름</summary>
        private static string CleanFolderName(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "";
            var cleaned = System.Text.RegularExpressions.Regex.Replace(name, @"【[^】]*】|\[[^\]]*\]", " ");
            if (string.IsNullOrWhiteSpace(cleaned)) cleaned = name;
            cleaned = System.Text.RegularExpressions.Regex.Replace(cleaned, @"\s+", " ").Trim(' ', '.', '-', '_', '/');
            foreach (var c in Path.GetInvalidFileNameChars()) cleaned = cleaned.Replace(c, '_');
            if (cleaned.Length > 60) cleaned = cleaned.Substring(0, 60).TrimEnd(' ', '.');
            return cleaned;
        }

        private static void EnsureFolder(string path)
        {
            path = NormalizeAssetPath(path);
            var parts = path.Split('/');
            var current = parts[0];
            for (var i = 1; i < parts.Length; i++)
            {
                var next = $"{current}/{parts[i]}";
                if (!AssetDatabase.IsValidFolder(next))
                    AssetDatabase.CreateFolder(current, parts[i]);
                current = next;
            }
        }

        private static string ParentPath(string path) => path.Substring(0, path.LastIndexOf('/'));

        private static string ToAbsPath(string assetPath)
        {
            assetPath = NormalizeAssetPath(assetPath);
            if (assetPath == "Assets") return Application.dataPath;
            return Path.Combine(Application.dataPath, assetPath.Substring("Assets/".Length).Replace('/', Path.DirectorySeparatorChar));
        }

        private static string NormalizeAssetPath(string path)
        {
            path = (path ?? "Assets").Replace('\\', '/').Trim();
            while (path.Contains("//"))
                path = path.Replace("//", "/");
            path = path.TrimEnd('/');
            return string.IsNullOrEmpty(path) ? "Assets" : path;
        }

        private static string ToAssetPath(string absPath)
        {
            var root = Application.dataPath.Replace('\\', '/').TrimEnd('/');
            var normalized = absPath.Replace('\\', '/');
            if (!normalized.StartsWith(root + "/", StringComparison.Ordinal))
                return normalized;
            return "Assets/" + normalized.Substring(root.Length + 1);
        }

        private static string SanitizeFolderName(string name)
        {
            foreach (var c in Path.GetInvalidFileNameChars())
                name = name.Replace(c, '_');
            return string.IsNullOrWhiteSpace(name) ? "미분류" : name;
        }

        private static string NormalizeUnityDuplicateName(string name)
        {
            return System.Text.RegularExpressions.Regex.Replace(name, @"_\d{1,3}$", "");
        }

        private static bool IsUnityDuplicateName(string name)
        {
            return !string.Equals(name, NormalizeUnityDuplicateName(name), StringComparison.Ordinal);
        }

        private static void Cleanup()
        {
            try { if (File.Exists(PendingFile)) File.Delete(PendingFile); } catch { }
        }

        [Serializable]
        private class PendingState
        {
            public string packagePath;
            public string tag;
            public string assetRoot;
            public string[] expectedFolders;
            public string[] packagePaths;
            public BoothFolderIcons.BoothMeta booth;
        }
    }
}
