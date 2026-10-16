using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using BoothImportManager;
using UnityEditor;
using UnityEngine;

namespace BoothThumbnailMatcher
{
    /// <summary>라이브러리에서 상품 직접 찾기 (이름·샵·상품 번호·URL)</summary>
    public class BtmPickWindow : EditorWindow
    {
        private string folderName = "";
        private string query = "";
        private string lastQuery = null;
        private List<BtmMatcher.Candidate> list = new List<BtmMatcher.Candidate>();
        private Action<BtmLibrary.Item> onPick;
        private Vector2 scroll;
        private bool focusDone;

        public static void Open(string folderPath, Action<BtmLibrary.Item> onPick)
        {
            var w = CreateInstance<BtmPickWindow>();
            w.folderName = System.IO.Path.GetFileName(folderPath);
            w.onPick = onPick;
            w.titleContent = new GUIContent("상품 찾기");
            w.minSize = new Vector2(460, 420);
            w.ShowUtility();
        }

        private void OnEnable()
        {
            wantsMouseMove = true;
            BtmThumbs.Repaint += Repaint;
        }

        private void OnDisable() => BtmThumbs.Repaint -= Repaint;

        private void OnGUI()
        {
            EditorGUILayout.LabelField("폴더", folderName, EditorStyles.boldLabel);
            GUI.SetNextControlName("q");
            query = EditorGUILayout.TextField("검색 (이름·샵·번호·URL)", query);
            if (!focusDone)
            {
                EditorGUI.FocusTextInControl("q");
                focusDone = true;
            }
            if (query != lastQuery)
            {
                lastQuery = query;
                list = BtmMatcher.Search(query, folderName);
            }

            // 라이브러리에 없는 상품 (선물·무료 배포 등): 번호/URL 로 바로
            var id = BimNet.ItemIdFrom(query ?? "");
            if (!string.IsNullOrEmpty(id) && !BtmLibrary.ById.ContainsKey(id))
            {
                if (GUILayout.Button($"상품 번호 {id} 로 연결 (라이브러리에 없는 상품 — 부스에서 정보를 받아요)"))
                {
                    var item = new BtmLibrary.Item { itemId = id, name = $"상품 {id}", shopName = "" };
                    BtmLibrary.Prepare(item);
                    Pick(item);
                    return;
                }
            }

            EditorGUILayout.LabelField(string.IsNullOrWhiteSpace(query) ? "폴더 이름과 비슷한 순서" : $"{list.Count}개", EditorStyles.miniLabel);
            scroll = EditorGUILayout.BeginScrollView(scroll);
            foreach (var c in list)
            {
                var rect = GUILayoutUtility.GetRect(10, 46, GUILayout.ExpandWidth(true));
                if (Event.current.type == EventType.Repaint && rect.Contains(Event.current.mousePosition))
                    EditorGUI.DrawRect(rect, new Color(0.5f, 0.5f, 0.5f, 0.15f));
                var thumb = BtmThumbs.Get(c.item);
                var tr = new Rect(rect.x + 2, rect.y + 2, 42, 42);
                if (thumb != null) GUI.DrawTexture(tr, thumb, ScaleMode.ScaleAndCrop);
                else EditorGUI.DrawRect(tr, new Color(0.5f, 0.5f, 0.5f, 0.2f));
                GUI.Label(new Rect(rect.x + 50, rect.y + 4, rect.width - 54, 18), c.item.name, EditorStyles.boldLabel);
                GUI.Label(new Rect(rect.x + 50, rect.y + 24, rect.width - 54, 16), $"{c.item.shopName} · #{c.item.itemId}", EditorStyles.miniLabel);
                if (GUI.Button(rect, GUIContent.none, GUIStyle.none))
                {
                    Pick(c.item);
                    GUIUtility.ExitGUI();
                }
            }
            EditorGUILayout.EndScrollView();
            if (Event.current.type == EventType.MouseMove) Repaint();
        }

        private void Pick(BtmLibrary.Item item)
        {
            onPick?.Invoke(item);
            Close();
        }
    }
}
