using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace BoothImportManager
{
    [InitializeOnLoad]
    public static class BoothQueueWatcher
    {
        private const string PrefsKey = "BoothImportManager.PendingFiles";
        private static readonly ConcurrentQueue<string> Queue = new ConcurrentQueue<string>();
        private static FileSystemWatcher watcher;
        private static bool isImporting;

        static BoothQueueWatcher()
        {
            RestoreQueue();
            EditorApplication.update += OnUpdate;
            ResetWatcher();
        }

        public static void ResetWatcher()
        {
            watcher?.Dispose();
            watcher = null;

            var settings = BoothImportSettings.instance;
            if (!settings.AutoImport || string.IsNullOrEmpty(settings.QueueFolder)) return;

            if (!Directory.Exists(settings.QueueFolder) && Directory.Exists(settings.WatchFolder))
                Directory.CreateDirectory(settings.QueueFolder);
            if (!Directory.Exists(settings.QueueFolder)) return;

            watcher = new FileSystemWatcher(settings.QueueFolder)
            {
                Filter = "*.unitypackage",
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite,
                EnableRaisingEvents = true,
            };
            watcher.Created += (_, e) => Enqueue(e.FullPath);
            ScanNow();
        }

        public static void ScanNow()
        {
            var folder = BoothImportSettings.instance.QueueFolder;
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) return;
            foreach (var file in Directory.GetFiles(folder, "*.unitypackage", SearchOption.AllDirectories))
                Enqueue(file);
        }

        public static void ImportFinished()
        {
            isImporting = false;
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
            if (isImporting || Queue.IsEmpty || !BoothImportSettings.instance.AutoImport) return;
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

        private static void PersistQueue()
        {
            EditorPrefs.SetString(PrefsKey, string.Join("|", Queue.ToArray()));
        }

        private static void RestoreQueue()
        {
            var saved = EditorPrefs.GetString(PrefsKey, "");
            if (string.IsNullOrEmpty(saved)) return;
            foreach (var path in saved.Split('|'))
                if (!string.IsNullOrEmpty(path))
                    Queue.Enqueue(path);
        }
    }
}
