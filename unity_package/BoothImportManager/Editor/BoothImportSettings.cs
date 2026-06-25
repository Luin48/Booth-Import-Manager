using System.IO;
using UnityEditor;

namespace BoothImportManager
{
    [FilePath("ProjectSettings/BoothImportManagerSettings.asset", FilePathAttribute.Location.ProjectFolder)]
    public class BoothImportSettings : ScriptableSingleton<BoothImportSettings>
    {
        public string WatchFolder = "";
        public string AssetRootFolder = "Assets";
        public bool AutoImport = true;

        public string QueueFolder => string.IsNullOrEmpty(WatchFolder)
            ? ""
            : Path.Combine(WatchFolder, "_queue");

        public void SaveSettings()
        {
            Save(true);
            BoothQueueWatcher.ResetWatcher();
        }
    }
}
