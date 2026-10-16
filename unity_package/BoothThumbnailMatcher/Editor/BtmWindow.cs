using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using BoothImportManager;
using UnityEditor;
using UnityEngine;

namespace BoothThumbnailMatcher
{
    /// <summary>
    /// BIM 썸네일 매칭 창: 이미 설치해 둔 에셋 폴더에 부스 썸네일 아이콘을 붙인다.
    /// </summary>
    public class BtmWindow : EditorWindow
    {
        private enum Tab { Auto, Review, None, Existing }

        private Tab tab = Tab.Auto;
        private Vector2 scroll;
        private BtmMatcher.Output output;
        private List<BtmPackages.Record> records;
        private bool scanning;
        private string scanProgress = "";
        private float scanFraction;
        private volatile bool scanCancel;
        private string message = "";
        private MessageType messageType = MessageType.None;
        private string filter = "";
        private bool showSources;

        [MenuItem("Tools/Booth Import Manager/썸네일 매칭 (설치된 에셋)", false, 20)]
        public static void Open()
        {
            var w = GetWindow<BtmWindow>();
            w.titleContent = new GUIContent("BIM 썸네일 매칭");
            w.minSize = new Vector2(620, 480);
            w.Show();
        }

        [MenuItem("Assets/Booth Import Manager/썸네일 매칭 창 열기", false, 2010)]
        private static void OpenFromAssets() => Open();

        private void OnEnable()
        {
            BtmThumbs.Repaint += Repaint;
            if (!BtmLibrary.Loaded) BtmLibrary.Load();
            EditorApplication.update += Poll;
        }

        private void OnDisable()
        {
            BtmThumbs.Repaint -= Repaint;
            EditorApplication.update -= Poll;
            scanCancel = true;
        }

        private double nextPoll;

        private void Poll()
        {
            if (scanning || BtmApply.Running) Repaint();
            if (EditorApplication.timeSinceStartup < nextPoll) return;
            nextPoll = EditorApplication.timeSinceStartup + 2;
            if (BtmLibrary.Changed)
            {
                BtmLibrary.Load();
                Notify(BtmLibrary.Loaded ? $"라이브러리 목록을 새로 읽었어요 (상품 {BtmLibrary.Items.Count}개)" : BtmLibrary.Error, BtmLibrary.Loaded ? MessageType.Info : MessageType.Warning);
                if (output != null && BtmLibrary.Loaded) Rematch();
                Repaint();
            }
        }

        private void Notify(string text, MessageType type = MessageType.Info)
        {
            message = text;
            messageType = type;
        }

        // ---- 스캔 -------------------------------------------------------------------
        private void Scan()
        {
            if (!BtmLibrary.Loaded)
            {
                Notify("먼저 부스 라이브러리 목록을 불러오세요", MessageType.Warning);
                return;
            }
            if (!BtmState.UseSources)
            {
                records = null;
                Rematch();
                return;
            }
            scanning = true;
            scanCancel = false;
            scanProgress = "원본 파일 찾는 중…";
            scanFraction = 0;
            var dirs = BtmPackages.SourceDirs(BtmState.ExtraDirs);
            Task.Run(() =>
            {
                List<BtmPackages.Record> recs = null;
                string error = null;
                try
                {
                    var files = BtmPackages.FindFiles(dirs, () => scanCancel);
                    recs = BtmPackages.Index(files, (text, f) =>
                    {
                        scanProgress = text;
                        scanFraction = f;
                    }, () => scanCancel);
                }
                catch (Exception e)
                {
                    error = e.Message;
                }
                BimContext.Post(() =>
                {
                    scanning = false;
                    if (scanCancel)
                    {
                        Notify("스캔을 멈췄어요. 이미 읽은 원본 파일은 기억해 둬서 다음엔 빨라요.", MessageType.Info);
                        return;
                    }
                    if (error != null) Notify($"원본 파일을 읽다가 문제가 생겼어요: {error} — 이름으로만 대조할게요", MessageType.Warning);
                    records = recs;
                    Rematch();
                });
            });
        }

        private void Rematch()
        {
            try
            {
                EditorUtility.DisplayProgressBar("BIM 썸네일 매칭", "폴더와 라이브러리를 대조하는 중…", 0.5f);
                var root = BtmMatcher.BuildTree(BtmState.IsHidden, out var count);
                output = BtmMatcher.Run(root, count, records, BtmState.IsCategory);
                var auto = output.results.Count(r => r.status == BtmMatcher.Status.Auto);
                var review = output.results.Count(r => r.status == BtmMatcher.Status.Review);
                var src = records == null ? "" : $" · 원본 파일 {output.packagesMatched}/{output.packageFiles}개 확인";
                Notify($"폴더 {count}개 확인 — 자동 {auto} · 확인 필요 {review} · 이미 아이콘 {output.existing.Count}{src}");
                tab = auto > 0 ? Tab.Auto : review > 0 ? Tab.Review : Tab.None;
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                Notify($"대조 중 오류: {e.Message}", MessageType.Error);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        // ---- 그리기 -------------------------------------------------------------------
        private static GUIStyle wrapMini;
        private static GUIStyle WrapMini => wrapMini ?? (wrapMini = new GUIStyle(EditorStyles.miniLabel) { wordWrap = true, clipping = TextClipping.Clip });

        private void OnGUI()
        {
            DrawLibraryBox();
            DrawSourceBox();
            DrawScanRow();
            if (!string.IsNullOrEmpty(message)) EditorGUILayout.HelpBox(message, messageType);
            if (output == null)
            {
                GUILayout.FlexibleSpace();
                return;
            }
            DrawTabs();
            DrawList();
            DrawFooter();
        }

        private void DrawLibraryBox()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("① 부스 라이브러리 목록", EditorStyles.boldLabel);
            EditorGUILayout.BeginHorizontal();
            if (BtmLibrary.Loaded)
            {
                var when = DateTime.TryParse(BtmLibrary.SavedAt, out var t) ? t.ToLocalTime().ToString("yyyy-MM-dd HH:mm") : BtmLibrary.SavedAt;
                EditorGUILayout.LabelField($"상품 {BtmLibrary.Items.Count}개 · {when} 저장", GUILayout.MinWidth(200));
            }
            else
            {
                EditorGUILayout.LabelField(string.IsNullOrEmpty(BtmLibrary.Error) ? "목록 없음" : BtmLibrary.Error, GUILayout.MinWidth(200));
            }
            if (GUILayout.Button(new GUIContent("부스에서 불러오기", "크롬으로 BOOTH 라이브러리를 열어 BIM 확장이 목록을 저장해요 (크롬이 기본 브라우저가 아니면 라이브러리 페이지의 '🖼 썸네일 매칭용 목록 저장'을 직접 누르세요)"), GUILayout.Width(130)))
            {
                Application.OpenURL("https://accounts.booth.pm/library#bim-library-export");
                Notify("크롬에서 BOOTH 라이브러리가 열리면 목록을 저장해요. 저장되면 여기서 자동으로 읽어요.");
            }
            if (GUILayout.Button("다시 읽기", GUILayout.Width(70))) BtmLibrary.Load();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.EndVertical();
        }

        private void DrawSourceBox()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.BeginHorizontal();
            var use = EditorGUILayout.ToggleLeft(new GUIContent("② 원본 파일로 정확히 찾기 (선택)", "받아 둔 zip·unitypackage 안의 GUID 를 프로젝트와 맞춰 봐요. 폴더를 옮기거나 이름을 바꿨어도 찾아요."), BtmState.UseSources, EditorStyles.boldLabel);
            if (use != BtmState.UseSources) BtmState.UseSources = use;
            GUILayout.FlexibleSpace();
            showSources = GUILayout.Toggle(showSources, showSources ? "폴더 ▾" : "폴더 ▸", EditorStyles.miniButton, GUILayout.Width(60));
            EditorGUILayout.EndHorizontal();
            if (use && showSources)
            {
                EditorGUILayout.LabelField("보관 폴더·크롬 다운로드 폴더는 자동으로 봐요 (하위 3단계까지). 처음 한 번은 오래 걸릴 수 있어요.", WrapMini);
                foreach (var d in BtmPackages.SourceDirs(null)) EditorGUILayout.LabelField("  • " + d, EditorStyles.miniLabel);
                var extra = BtmState.ExtraDirs;
                for (var i = 0; i < extra.Count; i++)
                {
                    EditorGUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField("  • " + extra[i], EditorStyles.miniLabel);
                    if (GUILayout.Button("빼기", EditorStyles.miniButton, GUILayout.Width(40)))
                    {
                        extra.RemoveAt(i);
                        BtmState.ExtraDirs = extra;
                        GUIUtility.ExitGUI();
                    }
                    EditorGUILayout.EndHorizontal();
                }
                if (GUILayout.Button("폴더 추가…", EditorStyles.miniButton, GUILayout.Width(80)))
                {
                    var picked = EditorUtility.OpenFolderPanel("원본 파일이 있는 폴더", "", "");
                    if (!string.IsNullOrEmpty(picked))
                    {
                        extra.Add(picked);
                        BtmState.ExtraDirs = extra;
                    }
                    GUIUtility.ExitGUI();
                }
            }
            EditorGUILayout.EndVertical();
        }

        private void DrawScanRow()
        {
            EditorGUILayout.BeginHorizontal();
            if (scanning)
            {
                var r = GUILayoutUtility.GetRect(10, 20, GUILayout.ExpandWidth(true));
                EditorGUI.ProgressBar(r, scanFraction, scanProgress);
                if (GUILayout.Button("멈추기", GUILayout.Width(70), GUILayout.Height(20))) scanCancel = true;
            }
            else
            {
                GUI.enabled = BtmLibrary.Loaded && !BtmApply.Running;
                if (GUILayout.Button(output == null ? "③ 스캔해서 대조하기" : "③ 다시 스캔", GUILayout.Height(26))) Scan();
                GUI.enabled = true;
            }
            EditorGUILayout.EndHorizontal();
        }

        private List<BtmMatcher.Result> Rows(Tab t)
        {
            if (output == null) return new List<BtmMatcher.Result>();
            var status = t == Tab.Auto ? BtmMatcher.Status.Auto : t == Tab.Review ? BtmMatcher.Status.Review : BtmMatcher.Status.None;
            IEnumerable<BtmMatcher.Result> rows = output.results.Where(r => !r.hidden && r.status == status);
            if (!string.IsNullOrWhiteSpace(filter))
            {
                var f = filter.Trim();
                rows = rows.Where(r => r.Path.IndexOf(f, StringComparison.OrdinalIgnoreCase) >= 0 || (r.chosen?.item.name ?? "").IndexOf(f, StringComparison.OrdinalIgnoreCase) >= 0);
            }
            return rows.ToList();
        }

        private void DrawTabs()
        {
            var labels = new[]
            {
                $"자동 매칭 ({Rows(Tab.Auto).Count})",
                $"확인 필요 ({Rows(Tab.Review).Count})",
                $"못 찾음 ({Rows(Tab.None).Count})",
                $"이미 있음 ({output.existing.Count})",
            };
            tab = (Tab)GUILayout.Toolbar((int)tab, labels, GUILayout.Height(24));
            EditorGUILayout.BeginHorizontal();
            filter = EditorGUILayout.TextField(filter, EditorStyles.toolbarSearchField);
            if (tab == Tab.Auto || tab == Tab.Review)
            {
                if (GUILayout.Button("모두 선택", EditorStyles.miniButton, GUILayout.Width(64)))
                    foreach (var r in Rows(tab)) r.selected = r.chosen != null;
                if (GUILayout.Button("모두 해제", EditorStyles.miniButton, GUILayout.Width(64)))
                    foreach (var r in Rows(tab)) r.selected = false;
            }
            if (BtmState.HiddenCount > 0 && GUILayout.Button($"숨긴 폴더 {BtmState.HiddenCount}개 다시 보기", EditorStyles.miniButton, GUILayout.Width(150)))
            {
                BtmState.ClearHidden();
                Rematch();
            }
            EditorGUILayout.EndHorizontal();
        }

        private void DrawList()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            if (tab == Tab.Existing)
            {
                foreach (var node in output.existing) DrawExisting(node);
            }
            else
            {
                var rows = Rows(tab);
                if (rows.Count == 0) EditorGUILayout.LabelField(tab == Tab.None ? "못 찾은 폴더가 없어요" : "없어요", EditorStyles.centeredGreyMiniLabel);
                var h = tab == Tab.Review ? 122f : tab == Tab.Auto ? 52f : 26f;
                // 보이는 줄만 그리기
                var viewTop = scroll.y;
                var viewBottom = scroll.y + position.height;
                for (var i = 0; i < rows.Count; i++)
                {
                    var top = i * (h + 2);
                    if (top + h < viewTop - 200 || top > viewBottom + 200)
                    {
                        GUILayoutUtility.GetRect(10, h + 2, GUILayout.ExpandWidth(true));
                        continue;
                    }
                    var rect = GUILayoutUtility.GetRect(10, h, GUILayout.ExpandWidth(true));
                    GUILayoutUtility.GetRect(10, 2);
                    if (tab == Tab.Auto) DrawAuto(rect, rows[i]);
                    else if (tab == Tab.Review) DrawReview(rect, rows[i]);
                    else DrawNone(rect, rows[i]);
                }
            }
            EditorGUILayout.EndScrollView();
        }

        private static void Ping(string path)
        {
            var obj = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(path);
            if (obj != null) EditorGUIUtility.PingObject(obj);
        }

        private static void DrawThumb(Rect r, BtmLibrary.Item item, bool shop)
        {
            EditorGUI.DrawRect(r, new Color(0.5f, 0.5f, 0.5f, 0.2f));
            var tex = BtmThumbs.Get(item);
            if (tex != null) GUI.DrawTexture(r, tex, ScaleMode.ScaleAndCrop);
            if (shop) GUI.Label(new Rect(r.x, r.yMax - 14, r.width, 14), "샵", EditorStyles.miniBoldLabel);
        }

        private static Texture folderIcon;
        private static GUIContent FolderLabel(string path)
        {
            if (folderIcon == null) folderIcon = EditorGUIUtility.IconContent("Folder Icon").image;
            return new GUIContent(" " + Short(path), folderIcon, path);
        }

        private static string Short(string path) => path.StartsWith("Assets/") ? path.Substring(7) : path;

        private static string ItemLabel(BtmMatcher.Result r, BtmLibrary.Item item) =>
            r.kind == "shop" ? $"샵: {item.shopName}" : $"{item.name}  ·  {item.shopName}";

        private void DrawAuto(Rect rect, BtmMatcher.Result r)
        {
            EditorGUI.DrawRect(rect, new Color(0.5f, 0.5f, 0.5f, 0.06f));
            r.selected = GUI.Toggle(new Rect(rect.x + 4, rect.y + 16, 18, 18), r.selected, GUIContent.none);
            var item = r.chosen?.item;
            DrawThumb(new Rect(rect.x + 26, rect.y + 4, 44, 44), item, r.kind == "shop");
            var x = rect.x + 78;
            var w = rect.width - 78 - 150;
            if (GUI.Button(new Rect(x, rect.y + 4, w, 18), FolderLabel(r.Path), EditorStyles.label)) Ping(r.Path);
            GUI.Label(new Rect(x, rect.y + 24, w, 18), item != null ? "→ " + ItemLabel(r, item) : "", EditorStyles.boldLabel);
            var reason = r.source == "guid" ? "원본 파일로 확인" : r.chosen?.reason ?? "";
            GUI.Label(new Rect(rect.xMax - 148, rect.y + 4, 144, 18), reason, EditorStyles.miniLabel);
            if (GUI.Button(new Rect(rect.xMax - 148, rect.y + 26, 68, 18), "다른 상품", EditorStyles.miniButton)) PickFor(r);
            if (GUI.Button(new Rect(rect.xMax - 76, rect.y + 26, 72, 18), "확인으로", EditorStyles.miniButton))
            {
                r.status = BtmMatcher.Status.Review;
                if (r.chosen != null && !r.candidates.Contains(r.chosen)) r.candidates.Insert(0, r.chosen);
            }
        }

        private void DrawReview(Rect rect, BtmMatcher.Result r)
        {
            EditorGUI.DrawRect(rect, new Color(0.5f, 0.5f, 0.5f, 0.06f));
            r.selected = GUI.Toggle(new Rect(rect.x + 4, rect.y + 4, 18, 18), r.selected && r.chosen != null, GUIContent.none) && r.chosen != null;
            if (GUI.Button(new Rect(rect.x + 24, rect.y + 3, rect.width - 260, 18), FolderLabel(r.Path), EditorStyles.boldLabel)) Ping(r.Path);
            var isShop = r.kind == "shop";
            var newShop = GUI.Toggle(new Rect(rect.xMax - 232, rect.y + 3, 70, 18), isShop, "샵 폴더", EditorStyles.miniButton);
            if (newShop != isShop) r.kind = newShop ? "shop" : "item";
            if (GUI.Button(new Rect(rect.xMax - 158, rect.y + 3, 74, 18), "직접 찾기…", EditorStyles.miniButton)) PickFor(r);
            if (GUI.Button(new Rect(rect.xMax - 80, rect.y + 3, 76, 18), new GUIContent("숨기기", "이 폴더는 다음 스캔부터 보여주지 않아요"), EditorStyles.miniButton)) Hide(r);

            var cardW = 132f;
            var x = rect.x + 24;
            var y = rect.y + 26;
            foreach (var c in r.candidates.Take(Mathf.Max(1, (int)((rect.width - 30) / (cardW + 6)))))
            {
                var card = new Rect(x, y, cardW, 92);
                var picked = r.chosen == c;
                EditorGUI.DrawRect(card, picked ? new Color(0.24f, 0.49f, 0.9f, 0.35f) : new Color(0.5f, 0.5f, 0.5f, 0.12f));
                DrawThumb(new Rect(card.x + 4, card.y + 4, 48, 48), c.item, r.kind == "shop");
                GUI.Label(new Rect(card.x + 56, card.y + 4, cardW - 60, 48), r.kind == "shop" ? c.item.shopName : c.item.name, WrapMini);
                GUI.Label(new Rect(card.x + 4, card.y + 54, cardW - 8, 16), r.kind == "shop" ? "" : c.item.shopName, EditorStyles.miniLabel);
                GUI.Label(new Rect(card.x + 4, card.y + 72, cardW - 8, 16), c.reason, EditorStyles.miniLabel);
                if (GUI.Button(card, new GUIContent("", $"{c.item.name}\n{c.item.shopName}\n#{c.item.itemId}"), GUIStyle.none))
                {
                    r.chosen = picked ? null : c;
                    r.selected = r.chosen != null;
                }
                x += cardW + 6;
            }
            if (r.candidates.Count == 0) GUI.Label(new Rect(x, y + 30, 300, 18), "후보 없음 — 직접 찾기로 고르세요", EditorStyles.miniLabel);
        }

        private void DrawNone(Rect rect, BtmMatcher.Result r)
        {
            if (GUI.Button(new Rect(rect.x + 4, rect.y + 4, rect.width - 290, 18), FolderLabel(r.Path), EditorStyles.label)) Ping(r.Path);
            if (GUI.Button(new Rect(rect.xMax - 282, rect.y + 4, 80, 18), "상품 찾기…", EditorStyles.miniButton)) PickFor(r);
            if (GUI.Button(new Rect(rect.xMax - 198, rect.y + 4, 112, 18), new GUIContent("분류 폴더로 보기", "01.헤어처럼 여러 샵·상품을 담는 폴더면 눌러요 → 그 안을 대조"), EditorStyles.miniButton))
            {
                BtmState.SetCategory(r.folder.guid, true);
                Rematch();
                GUIUtility.ExitGUI();
            }
            if (GUI.Button(new Rect(rect.xMax - 82, rect.y + 4, 78, 18), "숨기기", EditorStyles.miniButton)) Hide(r);
        }

        private void DrawExisting(BtmMatcher.Node node)
        {
            var e = BoothFolderIcons.Get(node.guid);
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button(FolderLabel(node.path), EditorStyles.label, GUILayout.MinWidth(200))) Ping(node.path);
            GUILayout.Label(e != null ? (e.kind == "shop" ? "샵: " : "") + e.title : "", EditorStyles.miniLabel, GUILayout.MinWidth(150));
            if (GUILayout.Button("아이콘 지우기", EditorStyles.miniButton, GUILayout.Width(80)))
            {
                BoothFolderIcons.Remove(node.path);
                Rematch();
                GUIUtility.ExitGUI();
            }
            EditorGUILayout.EndHorizontal();
        }

        private void Hide(BtmMatcher.Result r)
        {
            BtmState.SetHidden(r.folder.guid, true);
            r.hidden = true;
        }

        private void PickFor(BtmMatcher.Result r)
        {
            BtmPickWindow.Open(r.Path, item =>
            {
                var c = r.candidates.FirstOrDefault(x => x.item.itemId == item.itemId);
                if (c == null)
                {
                    c = new BtmMatcher.Candidate { item = item, score = 1, reason = "직접 고름" };
                    r.candidates.Insert(0, c);
                }
                r.chosen = c;
                r.selected = true;
                if (r.status == BtmMatcher.Status.None) r.status = BtmMatcher.Status.Review;
                tab = r.status == BtmMatcher.Status.Auto ? Tab.Auto : Tab.Review;
                Repaint();
            });
        }

        private void DrawFooter()
        {
            var picked = output.results.Where(r => !r.hidden && r.selected && r.chosen != null && r.status != BtmMatcher.Status.None).ToList();
            EditorGUILayout.BeginHorizontal(EditorStyles.helpBox);
            if (BtmApply.Running)
            {
                var r = GUILayoutUtility.GetRect(10, 22, GUILayout.ExpandWidth(true));
                EditorGUI.ProgressBar(r, BtmApply.Fraction, BtmApply.Progress);
                if (GUILayout.Button("멈추기", GUILayout.Width(70), GUILayout.Height(22))) BtmApply.Cancel();
            }
            else
            {
                var shopParent = EditorGUILayout.ToggleLeft(new GUIContent("상위 폴더가 샵 이름이면 샵 사진도", "상품 폴더 바로 위 폴더 이름이 샵 이름과 비슷하면 그 폴더에 샵 프로필 사진을 붙여요"), BtmState.ShopParent, GUILayout.Width(230));
                if (shopParent != BtmState.ShopParent) BtmState.ShopParent = shopParent;
                GUILayout.FlexibleSpace();
                GUI.enabled = picked.Count > 0;
                if (GUILayout.Button($"선택한 {picked.Count}개에 썸네일 붙이기", GUILayout.Height(24), GUILayout.Width(220))) ApplySelected(picked);
                GUI.enabled = true;
            }
            EditorGUILayout.EndHorizontal();
        }

        private void ApplySelected(List<BtmMatcher.Result> picked)
        {
            var shopFolders = new HashSet<string>(output.results.Where(r => r.kind == "shop").Select(r => r.Path));
            var jobs = BtmApply.Plan(picked, BtmState.ShopParent, shopFolders);
            BtmApply.Run(jobs, (ok, failed) =>
            {
                EditorApplication.RepaintProjectWindow();
                Rematch();
                Notify(failed == 0 ? $"썸네일 {ok}개를 붙였어요" : $"썸네일 {ok}개를 붙였어요 ({failed}개는 실패 — 콘솔 참고)", failed == 0 ? MessageType.Info : MessageType.Warning);
            });
        }
    }
}
