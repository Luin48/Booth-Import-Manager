using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;

namespace BoothImportManager
{
    /// <summary>ALCOM/VCC 프로젝트 찾기, 다른 프로젝트에 패키지 설치 (백그라운드 스레드에서 호출).</summary>
    public static class BimProjects
    {
        [Serializable]
        public class ProjectInfo
        {
            public string key;
            public string name;
            public string path;
            public string unityVersion;
            public string installed;        // "packages" | "assets:상대경로" | ""
            public string installedVersion;
            public bool open;               // 유니티가 열고 있음 (UnityLockfile 잠김)
            public bool self;
        }

        [Serializable]
        public class Suggestion
        {
            public string path;
            public string source;
            public int count;
        }

        public static bool IsUnityProject(string path) =>
            Directory.Exists(Path.Combine(path, "Assets")) && Directory.Exists(Path.Combine(path, "ProjectSettings"));

        public static string ReadUnityVersion(string path)
        {
            try
            {
                var text = File.ReadAllText(Path.Combine(path, "ProjectSettings", "ProjectVersion.txt"));
                var m = Regex.Match(text, "m_EditorVersion:\\s*(\\S+)");
                return m.Success ? m.Groups[1].Value : "";
            }
            catch
            {
                return "";
            }
        }

        public static List<string> ScanRoot(string root, int depth = 2)
        {
            var found = new List<string>();
            if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) return found;
            if (IsUnityProject(root)) { found.Add(root); return found; }
            string[] children;
            try { children = Directory.GetDirectories(root); }
            catch { return found; }
            foreach (var child in children.OrderBy(c => c, StringComparer.OrdinalIgnoreCase))
            {
                var name = Path.GetFileName(child);
                if (name.StartsWith(".") || name.StartsWith("_")) continue;
                if (IsUnityProject(child)) found.Add(child);
                else if (depth > 1) found.AddRange(ScanRoot(child, depth - 1));
            }
            return found;
        }

        public static string FindInstalled(string project)
        {
            if (File.Exists(Path.Combine(project, "Packages", BimContext.PackageName, "package.json"))) return "packages";
            try
            {
                foreach (var hit in Directory.EnumerateFiles(Path.Combine(project, "Assets"), "Boot*.cs", SearchOption.AllDirectories))
                {
                    var n = Path.GetFileName(hit);
                    if (n != "BoothQueueWatcher.cs" && n != "BoothPackageImporter.cs") continue;
                    var rel = Path.GetDirectoryName(hit)?.Substring(project.Length).TrimStart('\\', '/').Replace('\\', '/');
                    return "assets:" + rel;
                }
            }
            catch
            {
                // 권한 문제 등은 무시
            }
            return "";
        }

        [Serializable] private class PackageJson { public string name; public string version; }

        public static string PackageVersion(string packageDir)
        {
            try
            {
                var file = Path.Combine(packageDir, "package.json");
                return File.Exists(file) ? JsonUtility.FromJson<PackageJson>(File.ReadAllText(file))?.version ?? "" : "";
            }
            catch
            {
                return "";
            }
        }

        /// <summary>다른 유니티가 열고 있는지 (윈도우는 열려 있는 동안 UnityLockfile 을 잠근다)</summary>
        public static bool IsOpen(string project)
        {
            var lockFile = Path.Combine(project, "Temp", "UnityLockfile");
            if (!File.Exists(lockFile)) return false;
            try
            {
                using (new FileStream(lockFile, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
                return false;
            }
            catch (IOException)
            {
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static ProjectInfo Describe(string path)
        {
            path = Path.GetFullPath(path).TrimEnd('\\', '/');
            var key = BoothProjectKey.Compute(path);
            var installed = FindInstalled(path);
            var self = string.Equals(key, BimContext.ProjectKey, StringComparison.Ordinal);
            return new ProjectInfo
            {
                key = key,
                name = Path.GetFileName(path),
                path = path,
                unityVersion = ReadUnityVersion(path),
                installed = installed,
                installedVersion = installed == "packages" ? PackageVersion(Path.Combine(path, "Packages", BimContext.PackageName)) : "",
                open = self || IsOpen(path),
                self = self,
            };
        }

        public static List<ProjectInfo> Scan(string[] roots, string[] extra)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var list = new List<ProjectInfo>();
            void Add(string p)
            {
                try
                {
                    if (!IsUnityProject(p)) return;
                    var full = Path.GetFullPath(p).TrimEnd('\\', '/');
                    if (!seen.Add(full)) return;
                    list.Add(Describe(full));
                }
                catch
                {
                    // 하나 실패해도 계속
                }
            }
            foreach (var root in roots ?? Array.Empty<string>()) foreach (var p in ScanRoot(root)) Add(p);
            foreach (var p in extra ?? Array.Empty<string>()) Add(p);
            Add(BimContext.ProjectPath); // 지금 켜진 프로젝트는 항상 포함
            return list;
        }

        [Serializable] private class VccSettings { public string defaultProjectPath; public string[] userProjects; }

        public static List<Suggestion> Suggest()
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var outList = new List<Suggestion>();
            void Add(string path, string source)
            {
                if (string.IsNullOrEmpty(path) || !Directory.Exists(path)) return;
                var full = Path.GetFullPath(path).TrimEnd('\\', '/');
                if (outList.Any(o => string.Equals(o.path, full, StringComparison.OrdinalIgnoreCase))) return;
                outList.Add(new Suggestion { path = full, source = source, count = ScanRoot(full).Count });
            }

            Add(Path.Combine(home, "ALCOM", "Projects"), "ALCOM 기본 폴더");
            try
            {
                var vcc = Path.Combine(local, "VRChatCreatorCompanion", "settings.json");
                if (File.Exists(vcc))
                {
                    var data = JsonUtility.FromJson<VccSettings>(File.ReadAllText(vcc, Encoding.UTF8));
                    Add(data?.defaultProjectPath, "VCC 기본 프로젝트 폴더");
                    foreach (var g in (data?.userProjects ?? Array.Empty<string>())
                                 .Where(p => !string.IsNullOrEmpty(p))
                                 .GroupBy(p => Path.GetDirectoryName(p) ?? "")
                                 .OrderByDescending(g => g.Count()))
                        Add(g.Key, "ALCOM/VCC 등록 프로젝트 위치");
                }
            }
            catch
            {
                // 무시
            }
            Add(Path.Combine(local, "VRChatProjects"), "VCC 기본 폴더");
            Add(Path.Combine(home, "Documents", "VRChatProjects"), "문서/VRChatProjects");
            Add(Path.GetDirectoryName(BimContext.ProjectPath), "지금 켜진 프로젝트가 있는 폴더");
            return outList;
        }

        // ---- 설치 -----------------------------------------------------------------
        private static readonly HashSet<string> OldScriptNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "BoothQueueWatcher", "BoothPackageImporter", "BoothImportSettings", "BoothImportWindow",
            "BoothProjectKey", "BoothFolderIcons", "BoothImportManager.Editor",
            "BimContext", "BimJobRunner", "BimNet", "BimProjects", "BimServer", "BimZip",
        };

        private static void RemoveAssetsCopy(string project, string rel)
        {
            var editorDir = Path.Combine(project, rel.Replace('/', Path.DirectorySeparatorChar));
            if (!Directory.Exists(editorDir)) return;
            foreach (var f in Directory.GetFiles(editorDir))
            {
                var name = Path.GetFileName(f);
                var stem = name.EndsWith(".meta") ? name.Substring(0, name.Length - 5) : name;
                var baseName = stem.EndsWith(".cs") ? stem.Substring(0, stem.Length - 3)
                    : stem.EndsWith(".asmdef") ? stem.Substring(0, stem.Length - 7) : "";
                if (OldScriptNames.Contains(baseName)) File.Delete(f);
            }
            var parent = Path.GetDirectoryName(editorDir);
            var pkg = parent != null ? Path.Combine(parent, "package.json") : null;
            if (pkg != null && Path.GetFileName(parent) != "Assets" && File.Exists(pkg) && File.ReadAllText(pkg).Contains(BimContext.PackageName))
            {
                File.Delete(pkg);
                if (File.Exists(pkg + ".meta")) File.Delete(pkg + ".meta");
            }
            foreach (var d in new[] { editorDir, parent })
            {
                if (string.IsNullOrEmpty(d) || Path.GetFileName(d) == "Assets" || !Directory.Exists(d)) break;
                if (Directory.EnumerateFileSystemEntries(d).Any()) break;
                Directory.Delete(d);
                if (File.Exists(d + ".meta")) File.Delete(d + ".meta");
            }
        }

        private static void CopyDir(string src, string dst)
        {
            Directory.CreateDirectory(dst);
            foreach (var f in Directory.GetFiles(src)) File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
            foreach (var d in Directory.GetDirectories(src)) CopyDir(d, Path.Combine(dst, Path.GetFileName(d)));
        }

        /// <summary>지금 이 유니티에 설치된 패키지를 다른 프로젝트의 Packages 폴더로 복사.</summary>
        public static string Install(string projectPath)
        {
            if (!IsUnityProject(projectPath)) throw new ArgumentException("유니티 프로젝트 폴더가 아니에요");
            var src = BimContext.PackageRoot;
            if (string.IsNullOrEmpty(src) || !Directory.Exists(src)) throw new InvalidOperationException("이 유니티의 패키지 위치를 찾지 못했어요");
            var target = Path.Combine(projectPath, "Packages", BimContext.PackageName);
            if (string.Equals(Path.GetFullPath(src).TrimEnd('\\', '/'), Path.GetFullPath(target).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
                return "self";
            var installed = FindInstalled(projectPath);
            var migrated = false;
            if (installed.StartsWith("assets:"))
            {
                RemoveAssetsCopy(projectPath, installed.Substring(7));
                migrated = true;
            }
            if (Directory.Exists(target)) Directory.Delete(target, true);
            CopyDir(src, target);
            return migrated ? "migrated" : "packages";
        }
    }
}
