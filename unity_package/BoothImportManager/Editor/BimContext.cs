using System;
using System.Collections.Concurrent;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace BoothImportManager
{
    /// <summary>
    /// 여러 스레드에서 쓰는 값(프로젝트 경로/키 등)을 메인 스레드에서 미리 잡아두고,
    /// 크롬 확장과 같이 쓰는 폴더 위치를 정한다.
    ///
    /// 폴더 구조 (기본: 크롬 다운로드 폴더 안)
    ///   다운로드\BoothImportManager\
    ///     대기열\&lt;프로젝트 키&gt;\&lt;작업 id&gt;\파일.zip + job.json   ← 크롬 확장이 저장
    ///     보관\                                               ← 임포트 끝난 원본
    ///     _bim\done\&lt;작업 id&gt;.json                          ← 처리 결과 (확장이 상태 표시에 사용)
    ///     _bim\extract\&lt;작업 id&gt;\                            ← zip 임시 해제
    /// </summary>
    [InitializeOnLoad]
    public static class BimContext
    {
        public const string Version = "1.0.0";
        public const string PackageName = "local.booth-import-manager";

        public static string ProjectPath { get; private set; } = "";
        public static string ProjectKey { get; private set; } = "";
        public static string ProjectName { get; private set; } = "";
        public static string UnityVersion { get; private set; } = "";
        public static string PackageRoot { get; private set; } = "";
        public static int MainThreadId { get; private set; }

        static BimContext()
        {
            MainThreadId = Thread.CurrentThread.ManagedThreadId;
            ProjectPath = BoothProjectKey.ProjectPath;
            ProjectKey = BoothProjectKey.Compute(ProjectPath);
            ProjectName = Path.GetFileName(ProjectPath.TrimEnd('\\', '/'));
            UnityVersion = Application.unityVersion;
            try
            {
                var info = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(BimContext).Assembly);
                PackageRoot = info != null ? info.resolvedPath : "";
            }
            catch
            {
                PackageRoot = "";
            }
            EditorApplication.update += Pump;
        }

        // ---- 공용 설정 (%LOCALAPPDATA%\BoothImportManager\bim.json) ------------------------
        [Serializable]
        public class Shared
        {
            public string queueRoot = "";   // 비우면 크롬 다운로드 폴더\BoothImportManager
            public string archiveDir = "";  // 비우면 queueRoot\보관
            public bool keepArchive = true; // 임포트 후 원본을 보관 폴더로 (끄면 삭제)
        }

        private static readonly object SharedLock = new object();

        public static string SharedDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BoothImportManager");

        private static string SharedFile => Path.Combine(SharedDir, "bim.json");

        private static Shared sharedCache;
        private static DateTime sharedStamp;

        public static Shared ReadShared()
        {
            lock (SharedLock)
            {
                try
                {
                    if (!File.Exists(SharedFile)) return sharedCache = new Shared();
                    var stamp = File.GetLastWriteTimeUtc(SharedFile);
                    if (sharedCache != null && stamp == sharedStamp) return Copy(sharedCache);
                    sharedCache = JsonUtility.FromJson<Shared>(File.ReadAllText(SharedFile, Encoding.UTF8)) ?? new Shared();
                    sharedStamp = stamp;
                    return Copy(sharedCache);
                }
                catch
                {
                    return new Shared(); // 깨졌으면 기본값
                }
            }
        }

        private static Shared Copy(Shared s) => new Shared { queueRoot = s.queueRoot, archiveDir = s.archiveDir, keepArchive = s.keepArchive };

        public static void WriteShared(Shared value)
        {
            lock (SharedLock)
            {
                Directory.CreateDirectory(SharedDir);
                File.WriteAllText(SharedFile, JsonUtility.ToJson(value, true), Encoding.UTF8);
                sharedCache = null;
            }
        }

        /// <summary>크롬 기본 다운로드 폴더. 크롬 설정(Preferences)에서 읽고, 없으면 사용자\Downloads.</summary>
        private static string downloadsCache;
        private static DateTime downloadsCacheAt;

        public static string ChromeDownloadsDir()
        {
            if (downloadsCache != null && (DateTime.UtcNow - downloadsCacheAt).TotalSeconds < 60) return downloadsCache;
            downloadsCache = FindChromeDownloadsDir();
            downloadsCacheAt = DateTime.UtcNow;
            return downloadsCache;
        }

        private static string FindChromeDownloadsDir()
        {
            try
            {
                var userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "User Data");
                foreach (var profile in new[] { "Default", "Profile 1" })
                {
                    var prefs = Path.Combine(userData, profile, "Preferences");
                    if (!File.Exists(prefs)) continue;
                    var text = File.ReadAllText(prefs, Encoding.UTF8);
                    var m = Regex.Match(text, "\"default_directory\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                    if (!m.Success) continue;
                    var dir = Regex.Unescape(m.Groups[1].Value);
                    if (Directory.Exists(dir)) return dir;
                }
            }
            catch
            {
                // 무시
            }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        }

        public static string QueueRoot
        {
            get
            {
                var s = ReadShared();
                return !string.IsNullOrEmpty(s.queueRoot) ? s.queueRoot : Path.Combine(ChromeDownloadsDir(), "BoothImportManager");
            }
        }

        public static string QueueDir => Path.Combine(QueueRoot, "대기열");
        public static string MyQueueDir => Path.Combine(QueueDir, ProjectKey);
        public static string DoneDir => Path.Combine(QueueRoot, "_bim", "done");
        public static string ExtractRoot => Path.Combine(QueueRoot, "_bim", "extract");
        public static string ThumbDir => Path.Combine(SharedDir, "thumbs");

        public static string ArchiveDir
        {
            get
            {
                var s = ReadShared();
                return !string.IsNullOrEmpty(s.archiveDir) ? s.archiveDir : Path.Combine(QueueRoot, "보관");
            }
        }

        // ---- 메인 스레드 실행 (서버 스레드 → 유니티 API) --------------------------------
        private static readonly ConcurrentQueue<Action> MainQueue = new ConcurrentQueue<Action>();

        private static void Pump()
        {
            var n = 0;
            while (n++ < 20 && MainQueue.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception e) { Debug.LogException(e); }
            }
        }

        public static void Post(Action action) => MainQueue.Enqueue(action);

        /// <summary>메인 스레드에서 실행하고 결과를 기다린다 (서버 스레드 전용).</summary>
        public static T RunOnMain<T>(Func<T> func, int timeoutMs)
        {
            if (Thread.CurrentThread.ManagedThreadId == MainThreadId) return func();
            var done = new ManualResetEventSlim(false);
            T result = default;
            Exception error = null;
            MainQueue.Enqueue(() =>
            {
                try { result = func(); }
                catch (Exception e) { error = e; }
                finally { done.Set(); }
            });
            if (!done.Wait(timeoutMs)) throw new TimeoutException("유니티가 바빠서 응답하지 못했어요 (임포트/컴파일 중)");
            if (error != null) throw error;
            return result;
        }

        // ---- 공용 도우미 ------------------------------------------------------------
        public static double Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;

        public static string SafeFileName(string name, string fallback = "file")
        {
            if (string.IsNullOrEmpty(name)) return fallback;
            foreach (var c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
            name = name.Trim().TrimEnd('.');
            return string.IsNullOrEmpty(name) ? fallback : name;
        }

        public static string UniquePath(string path)
        {
            if (!File.Exists(path) && !Directory.Exists(path)) return path;
            var dir = Path.GetDirectoryName(path) ?? "";
            var stem = Path.GetFileNameWithoutExtension(path);
            var ext = Path.GetExtension(path);
            for (var i = 2; i < 1000; i++)
            {
                var candidate = Path.Combine(dir, $"{stem} ({i}){ext}");
                if (!File.Exists(candidate) && !Directory.Exists(candidate)) return candidate;
            }
            return Path.Combine(dir, $"{stem}_{DateTime.Now.Ticks}{ext}");
        }

        public static void TryDeleteDir(string dir)
        {
            try
            {
                if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) Directory.Delete(dir, true);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BoothImportManager] 폴더 정리 실패: {dir} - {e.Message}");
            }
        }
    }
}
