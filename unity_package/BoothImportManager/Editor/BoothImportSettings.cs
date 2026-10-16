using UnityEditor;

namespace BoothImportManager
{
    /// <summary>프로젝트별 설정 (ProjectSettings 에 저장). 폴더 위치는 크롬 확장과 같이 쓰는 공용 설정(BimContext.Shared).</summary>
    [FilePath("ProjectSettings/BoothImportManagerSettings.asset", FilePathAttribute.Location.ProjectFolder)]
    public class BoothImportSettings : ScriptableSingleton<BoothImportSettings>
    {
        // v0.3 호환용으로 남겨둔 칸 (쓰지 않음)
        public string WatchFolder = "";
        // 크롬 확장에서 프로젝트별 임포트 위치를 안 정했을 때 쓰는 기본값
        public string AssetRootFolder = "Assets";
        public bool AutoImport = true;
        // v0.3 로컬 앱이 남긴 대기열도 처리
        public bool WatchLegacyQueue = true;

        public void SaveSettings()
        {
            Save(true);
            BimJobRunner.ScanNow();
        }
    }
}
