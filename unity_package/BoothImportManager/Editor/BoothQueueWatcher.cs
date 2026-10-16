using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace BoothImportManager
{
    [InitializeOnLoad]
    public static class BoothQueueWatcher
    {
        public const string Version = "0.3.1";
        private const string PrefsKey = "BoothImportManager.PendingFiles";
        private const double HeartbeatInterval = 10.0;
        private static readonly ConcurrentQueue<string> Queue = new ConcurrentQueue<string>();
        private static readonly List<FileSystemWatcher> Watchers = new List<FileSystemWatcher>();
        private static bool isImporting;
        private static double nextHeartbeat;
        private static double nextRescan;

        public static bool IsImporting => isImporting;
        public static int PendingCount => Queue.Count;

        static BoothQueueWatcher()
        {
            RestoreQueue();
            EditorApplication.update += OnUpdate;
            EditorApplication.quitting += RemoveHeartbeat;
            ResetWatcher();
        }

        private static IEnumerable<string> WatchedFolders()
        {
            var settings = BoothImportSettings.instance;
            var project = settings.ProjectQueueFolder;
            if (!string.IsNullOrEmpty(project)) yield return project;
            if (settings.WatchLegacyQueue && !string.IsNullOrEmpty(settings.QueueFolder)) yield return settings.QueueFolder;
        }

        public static void ResetWatcher()
        {
            foreach (var w in Watchers) w.Dispose();
            Watchers.Clear();

            var settings = BoothImportSettings.instance;
            if (!settings.AutoImport || string.IsNullOrEmpty(settings.IntakeFolder)) return;

            foreach (var folder in WatchedFolders())
            {
                try
                {
                    if (!Directory.Exists(folder) && Directory.Exists(settings.IntakeFolder))
                        Directory.CreateDirectory(folder);
                    if (!Directory.Exists(folder)) continue;

                    var watcher = new FileSystemWatcher(folder)
                    {
                        Filter = "*.unitypackage",
                        IncludeSubdirectories = true,
                        NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite,
                        EnableRaisingEvents = true,
                    };
                    watcher.Created += (_, e) => Enqueue(e.FullPath);
                    watcher.Renamed += (_, e) => Enqueue(e.FullPath);
                    Watchers.Add(watcher);
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[BoothImportManager] Watch failed: {folder} - {e.Message}");
                }
            }
            WriteHeartbeat();
            ScanNow();
        }

        /// <summary>유니티를 켤 때(=도메인 리로드) 대기 중이던 파일을 전부 잡는다.</summary>
        public static void ScanNow()
        {
            foreach (var folder in WatchedFolders())
            {
                if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) continue;
                foreach (var file in Directory.GetFiles(folder, "*.unitypackage", SearchOption.AllDirectories).OrderBy(File.GetLastWriteTimeUtc))
                    Enqueue(file);
            }
        }

        public static void ImportFinished()
        {
            isImporting = false;
            WriteHeartbeat();
        }

        public static void SetImporting(bool value)
        {
            isImporting = value;
        }

        private static void Enqueue(string path)
        {
            if (Queue.Any(existing => existing == path)) return;
            Queue.Enqueue(path);
            PersistQueue();
        }

        private static void OnUpdate()
        {
            var now = EditorApplication.timeSinceStartup;
            if (now >= nextHeartbeat)
            {
                nextHeartbeat = now + HeartbeatInterval;
                WriteHeartbeat();
            }
            // 감시가 놓친 파일 대비 (네트워크 드라이브 등) 30초마다 재검사
            if (now >= nextRescan)
            {
                nextRescan = now + 30.0;
                if (Watchers.Count == 0 && BoothImportSettings.instance.AutoImport) ResetWatcher();
                else if (!isImporting) ScanNow();
            }

            if (isImporting || Queue.IsEmpty || !BoothImportSettings.instance.AutoImport) return;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (!Queue.TryPeek(out var path)) return;

            if (!IsFileReady(path))
            {
                if (!File.Exists(path))
                {
                    Queue.TryDequeue(out _);
                    PersistQueue();
                }
                return;
            }

            Queue.TryDequeue(out _);
            PersistQueue();

            var tag = Path.GetFileName(Path.GetDirectoryName(path)) ?? "미분류";
            isImporting = true;
            WriteHeartbeat();
            BoothPackageImporter.ImportPackage(path, tag);
        }

        private static bool IsFileReady(string path)
        {
            if (!File.Exists(path)) return false;
            try
            {
                using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.None);
                return stream.Length > 0;
            }
            catch
            {
                return false;
            }
        }

        [Serializable]
        private class Heartbeat
        {
            public string key;
            public string projectPath;
            public string version;
            public string unityVersion;
            public double time;
            public bool importing;
            public int pending;
        }

        private static void WriteHeartbeat()
        {
            try
            {
                var folder = BoothImportSettings.instance.ProjectQueueFolder;
                if (string.IsNullOrEmpty(folder)) return;
                Directory.CreateDirectory(folder);
                var hb = new Heartbeat
                {
                    key = BoothProjectKey.Current,
                    projectPath = BoothProjectKey.ProjectPath,
                    version = Version,
                    unityVersion = Application.unityVersion,
                    time = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0,
                    importing = isImporting,
                    pending = Queue.Count,
                };
                File.WriteAllText(Path.Combine(folder, ".heartbeat.json"), JsonUtility.ToJson(hb));
            }
            catch
            {
                // 하트비트는 표시용이라 실패해도 무시
            }
        }

        private static void RemoveHeartbeat()
        {
            try
            {
                var folder = BoothImportSettings.instance.ProjectQueueFolder;
                if (string.IsNullOrEmpty(folder)) return;
                var file = Path.Combine(folder, ".heartbeat.json");
                if (File.Exists(file)) File.Delete(file);
            }
            catch
            {
            }
        }

        private static void PersistQueue()
        {
            EditorPrefs.SetString(PrefsKey + "." + BoothProjectKey.Current, string.Join("|", Queue.ToArray()));
        }

        private static void RestoreQueue()
        {
            var saved = EditorPrefs.GetString(PrefsKey + "." + BoothProjectKey.Current, "");
            if (string.IsNullOrEmpty(saved)) return;
            foreach (var path in saved.Split('|'))
                if (!string.IsNullOrEmpty(path))
                    Queue.Enqueue(path);
        }
    }
}
