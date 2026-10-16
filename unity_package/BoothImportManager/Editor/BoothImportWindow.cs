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

            EditorGUILayout.LabelField($"Booth Import Manager v{BoothQueueWatcher.Version}", EditorStyles.boldLabel);
            EditorGUILayout.Space();

            EditorGUILayout.LabelField("Project key", BoothProjectKey.Current);
            EditorGUILayout.LabelField("Intake folder", string.IsNullOrEmpty(settings.IntakeFolder) ? "(로컬 앱을 한 번 실행하세요)" : settings.IntakeFolder);
            EditorGUILayout.LabelField("Project queue", settings.ProjectQueueFolder);
            EditorGUILayout.LabelField("Status", BoothQueueWatcher.IsImporting ? "임포트 중" : $"대기 {BoothQueueWatcher.PendingCount}개");
            EditorGUILayout.Space();

            EditorGUILayout.HelpBox("보통은 비워두세요. 비우면 로컬 앱이 남긴 bridge.json에서 보관 폴더를 찾습니다. Asset root는 크롬 확장 관리 페이지에서 프로젝트별로 정하는 값이 우선입니다.", MessageType.None);
            settings.WatchFolder = EditorGUILayout.TextField("Local intake folder", settings.WatchFolder);
            settings.AssetRootFolder = EditorGUILayout.TextField("Asset root (fallback)", settings.AssetRootFolder);
            settings.AutoImport = EditorGUILayout.Toggle("Auto import", settings.AutoImport);
            settings.WatchLegacyQueue = EditorGUILayout.Toggle("v0.2 공용 큐도 감시", settings.WatchLegacyQueue);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("폴더 아이콘", EditorStyles.boldLabel);
            BoothFolderIcons.Enabled = EditorGUILayout.Toggle($"부스 썸네일 표시 ({BoothFolderIcons.Count}개)", BoothFolderIcons.Enabled);
            EditorGUILayout.HelpBox("임포트할 때 자동으로 지정돼요. 이미 있는 폴더는 프로젝트 창에서 폴더 우클릭 → Booth Import Manager → 부스 상품 연결.", MessageType.None);

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
