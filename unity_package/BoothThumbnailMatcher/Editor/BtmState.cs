using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace BoothThumbnailMatcher
{
    /// <summary>
    /// 창 설정. 프로젝트마다: 숨긴 폴더, 분류 폴더 (UserSettings/BoothThumbnailMatcher/state.json)
    /// PC 공통: 원본 파일 폴더, 원본 대조 켬/끔 (EditorPrefs)
    /// </summary>
    public static class BtmState
    {
        [Serializable]
        private class Data
        {
            public List<string> hidden = new List<string>();
            public List<string> categories = new List<string>();
        }

        private const string Dir = "UserSettings/BoothThumbnailMatcher";
        private const string File_ = Dir + "/state.json";
        private const string ExtraKey = "BoothThumbnailMatcher.ExtraDirs";
        private const string UseSourcesKey = "BoothThumbnailMatcher.UseSources";
        private const string ShopParentKey = "BoothThumbnailMatcher.ShopParent";

        private static Data data;

        private static Data D
        {
            get
            {
                if (data != null) return data;
                try
                {
                    data = File.Exists(File_) ? JsonUtility.FromJson<Data>(File.ReadAllText(File_, Encoding.UTF8)) : null;
                }
                catch
                {
                    data = null;
                }
                data = data ?? new Data();
                return data;
            }
        }

        private static void Save()
        {
            try
            {
                Directory.CreateDirectory(Dir);
                File.WriteAllText(File_, JsonUtility.ToJson(D, true), Encoding.UTF8);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BIM 썸네일 매칭] 설정 저장 실패: {e.Message}");
            }
        }

        public static bool IsHidden(string guid) => !string.IsNullOrEmpty(guid) && D.hidden.Contains(guid);
        public static int HiddenCount => D.hidden.Count;

        public static void SetHidden(string guid, bool hidden)
        {
            if (string.IsNullOrEmpty(guid)) return;
            D.hidden.Remove(guid);
            if (hidden) D.hidden.Add(guid);
            Save();
        }

        public static void ClearHidden()
        {
            D.hidden.Clear();
            Save();
        }

        public static bool IsCategory(string guid) => !string.IsNullOrEmpty(guid) && D.categories.Contains(guid);

        public static void SetCategory(string guid, bool value)
        {
            if (string.IsNullOrEmpty(guid)) return;
            D.categories.Remove(guid);
            if (value) D.categories.Add(guid);
            Save();
        }

        public static List<string> ExtraDirs
        {
            get => EditorPrefs.GetString(ExtraKey, "").Split('|').Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
            set => EditorPrefs.SetString(ExtraKey, string.Join("|", value.Distinct()));
        }

        public static bool UseSources
        {
            get => EditorPrefs.GetBool(UseSourcesKey, true);
            set => EditorPrefs.SetBool(UseSourcesKey, value);
        }

        public static bool ShopParent
        {
            get => EditorPrefs.GetBool(ShopParentKey, true);
            set => EditorPrefs.SetBool(ShopParentKey, value);
        }
    }
}
