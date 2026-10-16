using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace BoothImportManager
{
    [FilePath("ProjectSettings/BoothImportManagerSettings.asset", FilePathAttribute.Location.ProjectFolder)]
    public class BoothImportSettings : ScriptableSingleton<BoothImportSettings>
    {
        // 비워두면 로컬 앱이 남긴 %LOCALAPPDATA%\BoothImportManager\bridge.json 에서 찾는다.
        public string WatchFolder = "";
        // 로컬 앱의 프로젝트 설정(project.json)이 있으면 그쪽이 우선.
        public string AssetRootFolder = "Assets";
        public bool AutoImport = true;
        // v0.2 방식 공용 큐(_queue)도 감시할지. 여러 프로젝트가 동시에 켜져 있으면 먼저 잡은 쪽이 가져간다.
        public bool WatchLegacyQueue = true;

        [Serializable]
        private class Bridge
        {
            public string intakeFolder;
            public string projectsQueueRoot;
            public string legacyQueueFolder;
            public int port;
        }

        private static Bridge ReadBridge()
        {
            try
            {
                var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                var path = Path.Combine(local, "BoothImportManager", "bridge.json");
                if (!File.Exists(path)) return null;
                return JsonUtility.FromJson<Bridge>(File.ReadAllText(path));
            }
            catch
            {
                return null;
            }
        }

        public string IntakeFolder
        {
            get
            {
                if (!string.IsNullOrEmpty(WatchFolder)) return WatchFolder;
                var bridge = ReadBridge();
                return bridge?.intakeFolder ?? "";
            }
        }

        public int LocalAppPort
        {
            get
            {
                var bridge = ReadBridge();
                return bridge != null && bridge.port > 0 ? bridge.port : 7831;
            }
        }

        public bool UsingBridge => string.IsNullOrEmpty(WatchFolder) && ReadBridge() != null;

        /// <summary>v0.2 공용 큐</summary>
        public string QueueFolder
        {
            get
            {
                if (string.IsNullOrEmpty(WatchFolder))
                {
                    var bridge = ReadBridge();
                    if (!string.IsNullOrEmpty(bridge?.legacyQueueFolder)) return bridge.legacyQueueFolder;
                }
                var intake = IntakeFolder;
                return string.IsNullOrEmpty(intake) ? "" : Path.Combine(intake, "_queue");
            }
        }

        /// <summary>v0.3 이 프로젝트 전용 큐</summary>
        public string ProjectQueueFolder
        {
            get
            {
                var intake = IntakeFolder;
                return string.IsNullOrEmpty(intake) ? "" : Path.Combine(intake, "_projects", BoothProjectKey.Current);
            }
        }

        [Serializable]
        private class ProjectFile
        {
            public string projectPath;
            public string name;
            public string assetRoot;
        }

        /// <summary>프로젝트 큐에서 온 패키지는 로컬 앱에서 정한 asset root 를 쓴다.</summary>
        public string ResolveAssetRoot(string packagePath)
        {
            try
            {
                var projectQueue = ProjectQueueFolder;
                if (!string.IsNullOrEmpty(projectQueue) && !string.IsNullOrEmpty(packagePath) &&
                    Path.GetFullPath(packagePath).StartsWith(Path.GetFullPath(projectQueue), StringComparison.OrdinalIgnoreCase))
                {
                    var file = Path.Combine(projectQueue, "project.json");
                    if (File.Exists(file))
                    {
                        var data = JsonUtility.FromJson<ProjectFile>(File.ReadAllText(file));
                        if (!string.IsNullOrEmpty(data?.assetRoot)) return data.assetRoot;
                    }
                }
            }
            catch
            {
                // fall through
            }
            return AssetRootFolder;
        }

        public void SaveSettings()
        {
            Save(true);
            BoothQueueWatcher.ResetWatcher();
        }
    }
}
