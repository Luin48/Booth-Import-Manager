using UnityEditor;
using UnityEngine;

namespace BoothImportManager
{
    public class BoothImportWindow : EditorWindow
    {
        [MenuItem("Tools/Booth Import Manager/Settings")]
        public static void Open()
        {
            GetWindow<BoothImportWindow>("Booth Import Manager");
        }

        private void OnGUI()
        {
            var settings = BoothImportSettings.instance;

            EditorGUILayout.LabelField("Booth Import Manager", EditorStyles.boldLabel);
            EditorGUILayout.Space();
            settings.WatchFolder = EditorGUILayout.TextField("Local intake folder", settings.WatchFolder);
            settings.AssetRootFolder = EditorGUILayout.TextField("Asset root", settings.AssetRootFolder);
            settings.AutoImport = EditorGUILayout.Toggle("Auto import", settings.AutoImport);

            EditorGUILayout.Space();
            if (GUILayout.Button("Save"))
            {
                settings.SaveSettings();
            }

            if (GUILayout.Button("Scan queue now"))
            {
                BoothQueueWatcher.ScanNow();
            }
        }
    }
}
