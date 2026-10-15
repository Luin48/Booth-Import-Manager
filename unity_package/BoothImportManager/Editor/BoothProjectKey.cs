using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;

namespace BoothImportManager
{
    /// <summary>
    /// 로컬 앱(projects.py)과 같은 규칙으로 프로젝트 키를 만든다.
    /// FNV-1a 32bit(정규화 경로) 8자리 hex + "_" + 폴더명
    /// </summary>
    public static class BoothProjectKey
    {
        public static string ProjectPath =>
            Path.GetFullPath(Path.Combine(Application.dataPath, ".."));

        public static string Normalize(string path)
        {
            return Path.GetFullPath(path).Replace('\\', '/').TrimEnd('/').ToLowerInvariant();
        }

        public static uint Fnv1a32(string text)
        {
            uint hash = 0x811C9DC5;
            foreach (var b in Encoding.UTF8.GetBytes(text))
            {
                hash ^= b;
                hash *= 0x01000193;
            }
            return hash;
        }

        public static string SafeName(string name)
        {
            var cleaned = Regex.Replace(name ?? "", "[<>:\"/\\\\|?*\\x00-\\x1f]", "_").Trim().TrimEnd('.');
            if (cleaned.Length > 40) cleaned = cleaned.Substring(0, 40);
            return string.IsNullOrEmpty(cleaned) ? "project" : cleaned;
        }

        public static string Compute(string projectPath)
        {
            var folder = Path.GetFileName(projectPath.Replace('\\', '/').TrimEnd('/'));
            return Fnv1a32(Normalize(projectPath)).ToString("x8") + "_" + SafeName(folder);
        }

        public static string Current => Compute(ProjectPath);
    }
}
