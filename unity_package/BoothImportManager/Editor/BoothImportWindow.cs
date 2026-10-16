using System.IO;
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

        private void OnInspectorUpdate() => Repaint();

        private static void PathRow(string label, string path)
        {
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(label, path);
            if (GUILayout.Button("열기", GUILayout.Width(48)))
            {
                Directory.CreateDirectory(path);
                EditorUtility.RevealInFinder(path);
            }
            EditorGUILayout.EndHorizontal();
        }

        private void OnGUI()
        {
            var settings = BoothImportSettings.instance;

            EditorGUILayout.LabelField($"Booth Import Manager v{BimContext.Version}", EditorStyles.boldLabel);
            EditorGUILayout.Space();

            EditorGUILayout.LabelField("크롬 확장 연결", BimServer.Port > 0 ? $"켜짐 (127.0.0.1:{BimServer.Port})" : "꺼짐 (포트 7840~7849 사용 중)");
            EditorGUILayout.LabelField("프로젝트 키", BimContext.ProjectKey);
            PathRow("대기열", BimContext.MyQueueDir);
            PathRow("보관 폴더", BimContext.ArchiveDir);
            var status = BimJobRunner.Busy
                ? $"처리 중: {BimJobRunner.CurrentFile}"
                : $"대기 {BimJobRunner.PendingCount}개";
            EditorGUILayout.LabelField("상태", status);
            if (!string.IsNullOrEmpty(BimJobRunner.LastLog)) EditorGUILayout.LabelField("최근", BimJobRunner.LastLog, EditorStyles.miniLabel);
            EditorGUILayout.Space();

            EditorGUILayout.HelpBox("폴더 위치·태그·프로젝트별 임포트 위치는 크롬 확장의 관리 페이지에서 정해요. 여기서는 이 프로젝트만의 설정을 바꿔요.", MessageType.None);
            settings.AutoImport = EditorGUILayout.Toggle("자동 임포트", settings.AutoImport);
            settings.AssetRootFolder = EditorGUILayout.TextField("기본 임포트 위치", settings.AssetRootFolder);
            settings.WatchLegacyQueue = EditorGUILayout.Toggle("v0.3 대기열도 처리", settings.WatchLegacyQueue);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("폴더 아이콘", EditorStyles.boldLabel);
            BoothFolderIcons.Enabled = EditorGUILayout.Toggle($"부스 썸네일 표시 ({BoothFolderIcons.Count}개)", BoothFolderIcons.Enabled);
            EditorGUILayout.HelpBox("임포트할 때 자동으로 지정돼요. 이미 있는 폴더는 프로젝트 창에서 폴더 우클릭 → Booth Import Manager → 부스 상품 연결.", MessageType.None);

            EditorGUILayout.Space();
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("저장")) settings.SaveSettings();
            if (GUILayout.Button("지금 대기열 확인")) BimJobRunner.ScanNow();
            EditorGUILayout.EndHorizontal();
        }
    }
}
