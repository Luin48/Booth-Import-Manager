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

            BoothQueueWatcher.SetImporting(true);
            var frame = 0;
            EditorApplication.update += Wait;
            void Wait()
            {
                if (++frame < 5) return;
                EditorApplication.update -= Wait;
                AfterImport(state);
            }
        }

        public static void ImportPackage(string packagePath, string tag)
        {
            if (!File.Exists(packagePath))
            {
                BoothQueueWatcher.ImportFinished();
                return;
            }

            var expectedFolders = ReadTopLevelFoldersFromPackage(packagePath).ToArray();
            var state = new PendingState
            {
                packagePath = packagePath,
                tag = tag,
                expectedFolders = expectedFolders,
            };
            File.WriteAllText(PendingFile, JsonUtility.ToJson(state), Encoding.UTF8);

            var packageName = Path.GetFileNameWithoutExtension(packagePath);
            AssetDatabase.importPackageCompleted += OnCompleted;
            AssetDatabase.importPackageFailed += OnFailed;
            AssetDatabase.ImportPackage(packagePath, false);

            void OnCompleted(string name)
            {
                if (name != packageName) return;
                AssetDatabase.importPackageCompleted -= OnCompleted;
                AssetDatabase.importPackageFailed -= OnFailed;
                AfterImport(state);
            }

            void OnFailed(string name, string error)
            {
                if (name != packageName) return;
                AssetDatabase.importPackageCompleted -= OnCompleted;
                AssetDatabase.importPackageFailed -= OnFailed;
                Debug.LogError($"[BoothImportManager] Import failed: {name} - {error}");
                Cleanup();
                BoothQueueWatcher.ImportFinished();
            }
        }

        private static void AfterImport(PendingState state)
        {
            if (!File.Exists(PendingFile)) return;
            Cleanup();

            var targetRoot = state.tag == UntaggedTagName
                ? BoothImportSettings.instance.AssetRootFolder
                : $"{BoothImportSettings.instance.AssetRootFolder}/{SanitizeFolderName(state.tag)}";
            EnsureFolder(targetRoot);
            AssetDatabase.Refresh();

            var importedRoots = FindImportedRootFolders(state, targetRoot);

            AssetDatabase.StartAssetEditing();
            try
            {
                foreach (var source in importedRoots)
                    MergeIntoTarget(source, $"{targetRoot}/{NormalizeUnityDuplicateName(Path.GetFileName(source))}");
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }

            try { File.Delete(state.packagePath); }
            catch (Exception e) { Debug.LogWarning($"[BoothImportManager] Queue file delete failed: {e.Message}"); }

            AssetDatabase.Refresh();
            BoothQueueWatcher.ImportFinished();
        }

        private static List<string> FindImportedRootFolders(PendingState state, string targetRoot)
        {
            var expectedNames = (state.expectedFolders ?? Array.Empty<string>())
                .Select(NormalizeUnityDuplicateName)
                .ToList();
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

            return roots
                .Distinct()
                .OrderBy(path => NormalizeUnityDuplicateName(Path.GetFileName(path)))
                .ThenBy(path => path)
                .ToList();
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

        private static List<string> ReadTopLevelFoldersFromPackage(string packagePath)
        {
            var topFolders = new HashSet<string>();
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
                        var assetPath = Encoding.UTF8.GetString(content).Trim('\0', '\n', '\r', ' ');
                        if (assetPath.StartsWith("Assets/"))
                        {
                            var parts = assetPath.Substring("Assets/".Length).Split('/');
                            if (parts.Length > 0 && !string.IsNullOrEmpty(parts[0]))
                                topFolders.Add(parts[0]);
                        }
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
            return topFolders.ToList();
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

        private static void EnsureFolder(string path)
        {
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
            => Path.Combine(Application.dataPath, assetPath.Substring("Assets/".Length).Replace('/', Path.DirectorySeparatorChar));

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

        private static void Cleanup()
        {
            try { if (File.Exists(PendingFile)) File.Delete(PendingFile); } catch { }
        }

        [Serializable]
        private class PendingState
        {
            public string packagePath;
            public string tag;
            public string[] expectedFolders;
        }
    }
}
