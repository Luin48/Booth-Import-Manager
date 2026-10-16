using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace BoothThumbnailMatcher
{
    /// <summary>
    /// 폴더 이름 ↔ 상품/샵 이름 비교용 문자열 처리.
    /// - 전각/반각, 대소문자, 기호(#!@[]_- 등)를 무시
    /// - 【SIUSIU対応】 같은 괄호 속 태그, 버전 표기(v1.2), 확장자는 떼어낸 이름도 후보로 쓴다
    /// </summary>
    public static class BtmText
    {
        private static readonly Regex Brackets = new Regex(@"[【\[［(（「『<＜〈《][^】\]］)）」』>＞〉》]*[】\]］)）」』>＞〉》]", RegexOptions.Compiled);
        private static readonly Regex Version = new Regex(@"(?<![a-z])(?:ver\.?|v)\s?\d+(?:[._]\d+)*[a-z]?(?![a-z])|(?<=[\s_-])\d+(?:[._]\d+){1,3}(?=$|[\s_-])", RegexOptions.Compiled | RegexOptions.IgnoreCase);
        private static readonly Regex Ext = new Regex(@"\.(zip|unitypackage|7z|rar|txt|pdf)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
        private static readonly Regex Seps = new Regex(@"\s*(?:/|／|\||｜|\s[-－~〜]\s|:|：)\s*", RegexOptions.Compiled);
        private static readonly Regex Camel = new Regex(@"(?<=[a-z])(?=[A-Z])", RegexOptions.Compiled);

        /// <summary>비교용 정규화: NFKC, 소문자, 글자·숫자만 남기고 나머지는 공백</summary>
        public static string Norm(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            s = s.Normalize(NormalizationForm.FormKC);
            s = Camel.Replace(s, " ");
            var sb = new StringBuilder(s.Length);
            var space = false;
            foreach (var ch in s.ToLowerInvariant())
            {
                if (char.IsLetterOrDigit(ch))
                {
                    sb.Append(ch);
                    space = false;
                }
                else if (!space && sb.Length > 0)
                {
                    sb.Append(' ');
                    space = true;
                }
            }
            return sb.ToString().Trim();
        }

        public static string Compact(string normalized) => normalized.Replace(" ", "");

        /// <summary>상품 이름 후보: 전체, 괄호 뗀 것, 구분자로 나눈 조각</summary>
        public static List<string> NameVariants(string name)
        {
            var list = new List<string>();
            if (string.IsNullOrWhiteSpace(name)) return list;
            void Add(string v)
            {
                var n = Norm(v);
                if (Compact(n).Length >= 2 && !list.Contains(n)) list.Add(n);
            }
            Add(name);
            var core = Brackets.Replace(name, " ");
            Add(core);
            foreach (var part in Seps.Split(core)) Add(part);
            Add(Version.Replace(core, " "));
            return list;
        }

        /// <summary>파일 이름 후보: 확장자·버전 표기를 뗀 것</summary>
        public static List<string> FileVariants(string fileName)
        {
            var list = new List<string>();
            if (string.IsNullOrWhiteSpace(fileName)) return list;
            var stem = Ext.Replace(fileName.Trim(), "");
            stem = Ext.Replace(stem, "");
            foreach (var v in new[] { stem, Version.Replace(stem, " "), Brackets.Replace(stem, " ") })
            {
                var n = Norm(v);
                if (Compact(n).Length >= 3 && !list.Contains(n)) list.Add(n);
            }
            return list;
        }

        /// <summary>비교를 빠르게 하려고 미리 계산해 둔 문자열 (정규화 결과·단어·글자쌍)</summary>
        public class Pre
        {
            public readonly string Norm;
            public readonly string Compact;
            public readonly HashSet<string> Tokens;
            public readonly Dictionary<string, int> Bigrams;
            public readonly int BigramCount;

            public Pre(string normalized)
            {
                Norm = normalized ?? "";
                Compact = BtmText.Compact(Norm);
                Tokens = new HashSet<string>(Norm.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Where(t => t.Length >= 2 || IsCjk(t)));
                Bigrams = new Dictionary<string, int>();
                for (var i = 0; i + 1 < Compact.Length; i++)
                {
                    var g = Compact.Substring(i, 2);
                    Bigrams[g] = Bigrams.TryGetValue(g, out var c) ? c + 1 : 1;
                }
                BigramCount = Math.Max(0, Compact.Length - 1);
            }
        }

        public static Pre Prepare(string raw) => new Pre(Norm(raw));

        public static List<Pre> PrepareAll(IEnumerable<string> normalized) => normalized.Where(v => !string.IsNullOrEmpty(v)).Select(v => new Pre(v)).ToList();

        private static bool IsCjk(string t) => t.Any(c => c >= 0x3040);

        private static double Dice(Pre a, Pre b)
        {
            if (a.BigramCount == 0 || b.BigramCount == 0) return a.Compact == b.Compact ? 1 : 0;
            var hit = 0;
            var small = a.Bigrams.Count <= b.Bigrams.Count ? a : b;
            var big = ReferenceEquals(small, a) ? b : a;
            foreach (var kv in small.Bigrams)
                if (big.Bigrams.TryGetValue(kv.Key, out var c)) hit += Math.Min(c, kv.Value);
            return 2.0 * hit / (a.BigramCount + b.BigramCount);
        }

        /// <summary>
        /// 폴더 이름(a)과 상품/샵 이름 후보(b)의 유사도 (0~1).
        /// 같으면 1, 포함 관계면 길이 비율에 따라, 아니면 단어 겹침/글자쌍 겹침 중 큰 값.
        /// </summary>
        public static double Similarity(Pre a, Pre b)
        {
            if (a == null || b == null || a.Compact.Length == 0 || b.Compact.Length == 0) return 0;
            if (a.Compact == b.Compact) return 1;
            var shortLen = Math.Min(a.Compact.Length, b.Compact.Length);
            var longLen = Math.Max(a.Compact.Length, b.Compact.Length);
            var ratio = (double)shortLen / longLen;
            double best = 0;
            // a = 폴더 이름, b = 상품/샵 이름 후보
            if (a.Compact.Length < b.Compact.Length && a.Compact.Length >= 3 && b.Compact.Contains(a.Compact))
                best = ratio >= 0.5 ? 0.72 + 0.28 * ratio : 0.55 + 0.5 * ratio; // 상품 이름의 일부만 폴더 이름으로 씀
            else if (b.Compact.Length < a.Compact.Length && a.Compact.Contains(b.Compact) && (b.Compact.Length >= 5 || ratio >= 0.6))
                best = 0.62 + 0.36 * ratio; // 짧은 이름이 폴더 이름 안에 (짧으면 우연일 수 있어 낮게)
            if (a.Tokens.Count > 0 && b.Tokens.Count > 0)
            {
                var inter = 0;
                foreach (var t in a.Tokens)
                    if (b.Tokens.Contains(t)) inter++;
                if (inter > 0)
                {
                    var cover = (double)inter / Math.Min(a.Tokens.Count, b.Tokens.Count);
                    var jac = (double)inter / (a.Tokens.Count + b.Tokens.Count - inter);
                    best = Math.Max(best, 0.55 * cover + 0.4 * jac);
                }
            }
            if (best < 0.9) best = Math.Max(best, 0.9 * Dice(a, b));
            return Math.Min(1, best);
        }

        public static double Similarity(string a, string b) => Similarity(new Pre(Norm(a)), new Pre(Norm(b)));

        public static double Best(List<Pre> folder, List<Pre> variants)
        {
            double best = 0;
            foreach (var f in folder)
            {
                var v = Best(f, variants);
                if (v > best) best = v;
            }
            return best;
        }

        public static double Best(Pre folder, List<Pre> variants)
        {
            double best = 0;
            foreach (var v in variants)
            {
                var s = Similarity(folder, v);
                if (s > best) best = s;
                if (best >= 1) break;
            }
            return best;
        }

        // ---- 폴더 종류 ----------------------------------------------------------------
        private static readonly HashSet<string> GenericWords = new HashSet<string>(new[]
        {
            "ver", "version", "new", "old", "copy", "temp", "tmp", "package", "packages", "unitypackage", "ndmf", "vrc", "editor", "runtime", "script", "scripts", "shader", "shaders", "material", "materials", "mat", "mats", "texture", "textures", "tex",
            "prefab", "prefabs", "fbx", "model", "models", "mesh", "meshes", "animation", "animations", "anim", "anims", "animator", "controller",
            "controllers", "sound", "sounds", "audio", "sample", "samples", "example", "examples", "demo", "test", "tests", "documentation", "docs",
            "doc", "manual", "readme", "license", "licence", "plugins", "plugin", "resources", "generated", "cache", "gizmos", "fonts", "font",
            "icon", "icons", "image", "images", "ui", "menu", "menus", "expression", "expressions", "setup", "localize", "localization", "matcap",
            "matcaps", "mask", "masks", "normal", "normalmap", "normal map", "common", "shared", "settings", "data", "psd", "png", "blend",
            "textture", "validation", "include", "includes", "lib", "libs", "core", "src", "assets", "asset", "other", "others", "etc", "backup",
            "fx", "vfx", "particle", "particles", "parameter", "parameters", "avatar", "avatars", "base", "addon", "addons", "option", "options",
        });

        /// <summary>Editor/Materials/1.Prefab 같은 내부 폴더 이름인지</summary>
        public static bool IsGeneric(string folderName)
        {
            var n = Norm(Regex.Replace(folderName ?? "", @"^[\s\d._\-#!@]+", ""));
            if (n.Length == 0) return true;
            if (GenericWords.Contains(n) || GenericWords.Contains(Compact(n))) return true;
            var words = n.Split(' ');
            return words.Length <= 3 && words.All(w => GenericWords.Contains(w) || Regex.IsMatch(w, @"^\d+$"));
        }

        private static readonly Regex Numbering = new Regex(@"^\s*\d{1,3}\s*[._\-\s]\s*", RegexOptions.Compiled);

        /// <summary>폴더 이름 후보: 그대로, 앞 번호(04.) 뗀 것, 버전(_v1.0.0) 뗀 것</summary>
        public static List<Pre> FolderVariants(string name)
        {
            var list = new List<Pre> { Prepare(name) };
            foreach (var alt in new[] { Numbering.Replace(name ?? "", ""), Version.Replace(name ?? "", " ") })
            {
                var n = Norm(alt);
                if (Compact(n).Length >= 2 && list.All(x => x.Norm != n)) list.Add(new Pre(n));
            }
            return list;
        }

        private static readonly Regex CategoryPattern = new Regex(@"^\s*\d{1,3}\s*[._\-\s]\s*\S", RegexOptions.Compiled);

        /// <summary>01.헤어, 02.옷 처럼 사용자가 만든 분류 폴더처럼 보이는지 (이름만 보고)</summary>
        public static bool LooksLikeCategory(string folderName) => CategoryPattern.IsMatch(folderName ?? "");
    }
}
