using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using BoothImportManager;
using UnityEngine;

namespace BoothThumbnailMatcher
{
    /// <summary>
    /// 원본 파일(.unitypackage / .zip) 목록과, 그 안에 든 에셋의 GUID·경로.
    /// 프로젝트의 .meta GUID 와 맞춰 보면 폴더를 옮기거나 이름을 바꿨어도 정확히 찾을 수 있다.
    /// 읽은 결과는 %LOCALAPPDATA%\BoothImportManager\matcher\packages.json 에 저장해 두고 다시 쓰지 않는다.
    /// </summary>
    public static class BtmPackages
    {
        [Serializable]
        public class Ent
        {
            public string g; // guid
            public string p; // Assets/... 경로
        }

        [Serializable]
        public class Pkg
        {
            public string inner = "";                 // zip 안의 unitypackage 이름 ("" = 파일 자체)
            public List<Ent> folders = new List<Ent>();
            public List<Ent> files = new List<Ent>();  // 최대 MaxFiles 개 (고르게 뽑음)
            public int fileCount;
        }

        [Serializable]
        public class Record
        {
            public string path;
            public long size;
            public long mtime;
            public string error = "";
            public List<Pkg> packages = new List<Pkg>();
        }

        [Serializable]
        private class CacheData
        {
            public int version = 1;
            public List<Record> records = new List<Record>();
        }

        [Serializable]
        private class DoneFile
        {
            public string archivedPath;
            public string filename;
            public string itemId;
        }

        private const int MaxFiles = 400;
        private static string CacheFile => Path.Combine(BimContext.SharedDir, "matcher", "packages.json");

        // ---- 원본 폴더 ------------------------------------------------------------
        /// <summary>찾아볼 폴더: BIM 보관 폴더, 크롬 다운로드 폴더, 사용자가 추가한 폴더</summary>
        public static List<string> SourceDirs(IEnumerable<string> extra)
        {
            var list = new List<string>();
            void Add(string d)
            {
                if (string.IsNullOrWhiteSpace(d)) return;
                try { d = Path.GetFullPath(d); } catch { return; }
                if (Directory.Exists(d) && !list.Any(x => string.Equals(x, d, StringComparison.OrdinalIgnoreCase))) list.Add(d);
            }
            Add(BimContext.ArchiveDir);
            Add(BimContext.ChromeDownloadsDir());
            foreach (var d in extra ?? Enumerable.Empty<string>()) Add(d);
            return list;
        }

        /// <summary>폴더 안의 원본 후보 파일 (하위 3단계까지, 대기열/임시 폴더 제외)</summary>
        public static List<string> FindFiles(IEnumerable<string> dirs, Func<bool> cancel)
        {
            var found = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            void Walk(string dir, int depth)
            {
                if (cancel()) return;
                string[] files, subs;
                try
                {
                    files = Directory.GetFiles(dir);
                    subs = depth < 3 ? Directory.GetDirectories(dir) : new string[0];
                }
                catch
                {
                    return;
                }
                foreach (var f in files)
                {
                    var ext = Path.GetExtension(f).ToLowerInvariant();
                    if ((ext == ".unitypackage" || ext == ".zip") && seen.Add(f)) found.Add(f);
                }
                foreach (var s in subs)
                {
                    var name = Path.GetFileName(s);
                    if (name == "대기열" || name == "_bim" || name.StartsWith(".")) continue;
                    Walk(s, depth + 1);
                }
            }
            foreach (var d in dirs) Walk(d, 0);
            return found;
        }

        // ---- 캐시 -----------------------------------------------------------------
        private static Dictionary<string, Record> LoadCache()
        {
            var map = new Dictionary<string, Record>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (File.Exists(CacheFile))
                {
                    var data = JsonUtility.FromJson<CacheData>(File.ReadAllText(CacheFile, Encoding.UTF8));
                    foreach (var r in data?.records ?? new List<Record>())
                        if (!string.IsNullOrEmpty(r.path)) map[r.path] = r;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BIM 썸네일 매칭] 원본 목록 캐시를 읽지 못했어요: {e.Message}");
            }
            return map;
        }

        private static void SaveCache(IEnumerable<Record> records)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(CacheFile) ?? BimContext.SharedDir);
                var data = new CacheData { records = records.ToList() };
                File.WriteAllText(CacheFile, JsonUtility.ToJson(data), Encoding.UTF8);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BIM 썸네일 매칭] 원본 목록 캐시 저장 실패: {e.Message}");
            }
        }

        /// <summary>
        /// 파일들을 읽는다 (백그라운드 스레드에서 호출). 이미 읽은 파일은 캐시를 쓴다.
        /// progress(설명, 0~1)
        /// </summary>
        public static List<Record> Index(List<string> files, Action<string, float> progress, Func<bool> cancel)
        {
            var cache = LoadCache();
            var result = new List<Record>();
            var changed = false;
            for (var n = 0; n < files.Count; n++)
            {
                if (cancel()) break;
                var path = files[n];
                FileInfo info;
                try { info = new FileInfo(path); } catch { continue; }
                if (!info.Exists) continue;
                var mtime = info.LastWriteTimeUtc.Ticks;
                if (cache.TryGetValue(path, out var cached) && cached.size == info.Length && cached.mtime == mtime)
                {
                    result.Add(cached);
                    continue;
                }
                progress?.Invoke($"원본 파일 읽는 중 ({n + 1}/{files.Count}) {Path.GetFileName(path)}", (float)n / Math.Max(1, files.Count));
                var rec = new Record { path = path, size = info.Length, mtime = mtime };
                try
                {
                    if (path.EndsWith(".unitypackage", StringComparison.OrdinalIgnoreCase))
                    {
                        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
                        {
                            var pkg = ReadUnityPackage(fs, cancel);
                            if (pkg != null) rec.packages.Add(pkg);
                        }
                    }
                    else if (BimZip.IsZip(path))
                    {
                        rec.packages.AddRange(ReadZip(path, cancel));
                    }
                }
                catch (Exception e)
                {
                    rec.error = e.Message;
                }
                if (cancel()) break;
                cache[path] = rec;
                result.Add(rec);
                changed = true;
            }
            if (changed) SaveCache(cache.Values.Where(r => File.Exists(r.path)));
            return result;
        }

        // ---- zip --------------------------------------------------------------------
        private static readonly Regex GuidLine = new Regex(@"^guid:\s*([0-9a-f]{32})", RegexOptions.Multiline | RegexOptions.Compiled);

        private static List<Pkg> ReadZip(string zipPath, Func<bool> cancel)
        {
            var list = new List<Pkg>();
            // 1) zip 안의 unitypackage
            BimZip.ForEachEntry(
                zipPath,
                (name, size) => !cancel() && name.EndsWith(".unitypackage", StringComparison.OrdinalIgnoreCase),
                (name, stream) =>
                {
                    var pkg = ReadUnityPackage(stream, cancel);
                    if (pkg == null) return;
                    pkg.inner = name;
                    list.Add(pkg);
                });
            // 2) 폴더째 넣는 zip (Assets 에 바로 복사하는 형식): .meta 의 guid
            var metas = new Pkg { inner = "(meta)" };
            var allFiles = new List<Ent>();
            BimZip.ForEachEntry(
                zipPath,
                (name, size) => !cancel() && name.EndsWith(".meta", StringComparison.OrdinalIgnoreCase) && size < 1 << 20,
                (name, stream) =>
                {
                    string text;
                    using (var reader = new StreamReader(stream, Encoding.UTF8, true, 4096, true)) text = reader.ReadToEnd();
                    var m = GuidLine.Match(text);
                    if (!m.Success) return;
                    var assetPath = name.Substring(0, name.Length - ".meta".Length).TrimStart('/');
                    var idx = assetPath.IndexOf("Assets/", StringComparison.Ordinal);
                    assetPath = idx >= 0 ? assetPath.Substring(idx) : "Assets/" + assetPath;
                    var ent = new Ent { g = m.Groups[1].Value, p = assetPath };
                    if (text.Contains("folderAsset: yes")) metas.folders.Add(ent);
                    else allFiles.Add(ent);
                });
            if (metas.folders.Count + allFiles.Count > 0)
            {
                metas.fileCount = allFiles.Count;
                metas.files = Sample(allFiles);
                list.Add(metas);
            }
            return list;
        }

        // ---- unitypackage (tar.gz) --------------------------------------------------
        private static Pkg ReadUnityPackage(Stream raw, Func<bool> cancel)
        {
            var paths = new Dictionary<string, string>();
            var hasAsset = new HashSet<string>();
            using (var gz = new GZipStream(raw, CompressionMode.Decompress, true))
            {
                var header = new byte[512];
                string longName = null;
                var skipBuf = new byte[1 << 16];
                while (true)
                {
                    if (cancel()) return null;
                    if (!ReadFully(gz, header, 512)) break;
                    if (header.All(b => b == 0)) break;
                    var name = Ascii(header, 0, 100);
                    var prefix = Ascii(header, 345, 155);
                    if (!string.IsNullOrEmpty(prefix) && header[257] == (byte)'u') name = prefix + "/" + name;
                    var type = (char)header[156];
                    var size = ParseSize(header);
                    if (longName != null)
                    {
                        name = longName;
                        longName = null;
                    }
                    if (type == 'L')
                    {
                        var buf = new byte[size];
                        ReadFully(gz, buf, (int)size);
                        longName = Encoding.UTF8.GetString(buf).TrimEnd('\0');
                        Skip(gz, Pad(size), skipBuf);
                        continue;
                    }
                    name = name.Replace('\\', '/');
                    if (name.StartsWith("./")) name = name.Substring(2);
                    var slash = name.IndexOf('/');
                    var guid = slash > 0 ? name.Substring(0, slash) : "";
                    var leaf = slash > 0 ? name.Substring(slash + 1) : "";
                    if (type != 'x' && type != 'g' && guid.Length == 32 && leaf == "pathname" && size > 0 && size < 8192)
                    {
                        var buf = new byte[size];
                        ReadFully(gz, buf, (int)size);
                        var p = Encoding.UTF8.GetString(buf).Split('\n')[0].Trim('\0', '\r', ' ');
                        if (p.StartsWith("Assets/")) paths[guid] = p.TrimEnd('/');
                        Skip(gz, Pad(size), skipBuf);
                        continue;
                    }
                    if (guid.Length == 32 && leaf == "asset") hasAsset.Add(guid);
                    Skip(gz, size + Pad(size), skipBuf);
                }
            }
            if (paths.Count == 0) return null;
            var pkg = new Pkg();
            var files = new List<Ent>();
            foreach (var kv in paths)
            {
                var ent = new Ent { g = kv.Key, p = kv.Value };
                if (hasAsset.Contains(kv.Key)) files.Add(ent);
                else pkg.folders.Add(ent);
            }
            pkg.fileCount = files.Count;
            pkg.files = Sample(files);
            return pkg;
        }

        private static List<Ent> Sample(List<Ent> files)
        {
            if (files.Count <= MaxFiles) return files;
            var step = (double)files.Count / MaxFiles;
            var list = new List<Ent>();
            for (var i = 0; i < MaxFiles; i++) list.Add(files[(int)(i * step)]);
            return list;
        }

        private static string Ascii(byte[] b, int start, int len)
        {
            var end = start;
            while (end < start + len && b[end] != 0) end++;
            return Encoding.UTF8.GetString(b, start, end - start);
        }

        private static long ParseSize(byte[] h)
        {
            if ((h[124] & 0x80) != 0)
            {
                long v = 0;
                for (var i = 125; i < 136; i++) v = (v << 8) | h[i];
                return v;
            }
            var s = Encoding.ASCII.GetString(h, 124, 12).Trim('\0', ' ');
            return string.IsNullOrEmpty(s) ? 0 : Convert.ToInt64(s, 8);
        }

        private static long Pad(long size) => (512 - size % 512) % 512;

        private static bool ReadFully(Stream s, byte[] buf, int count)
        {
            var off = 0;
            while (off < count)
            {
                var r = s.Read(buf, off, count - off);
                if (r <= 0) return false;
                off += r;
            }
            return true;
        }

        private static void Skip(Stream s, long count, byte[] buf)
        {
            while (count > 0)
            {
                var r = s.Read(buf, 0, (int)Math.Min(buf.Length, count));
                if (r <= 0) return;
                count -= r;
            }
        }

        // ---- 원본 파일 → 상품 --------------------------------------------------------
        /// <summary>BIM 처리 기록(_bim\done)에서 보관 파일 → 상품 번호</summary>
        public static Dictionary<string, string> ArchivedItems()
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                if (!Directory.Exists(BimContext.DoneDir)) return map;
                foreach (var f in Directory.GetFiles(BimContext.DoneDir, "*.json"))
                {
                    try
                    {
                        var d = JsonUtility.FromJson<DoneFile>(File.ReadAllText(f, Encoding.UTF8));
                        if (!string.IsNullOrEmpty(d?.archivedPath) && !string.IsNullOrEmpty(d.itemId)) map[Path.GetFullPath(d.archivedPath)] = d.itemId;
                    }
                    catch
                    {
                        // 깨진 기록은 무시
                    }
                }
            }
            catch
            {
                // 무시
            }
            return map;
        }

        /// <summary>원본 파일이 어느 상품(들)인지: BIM 기록 → 옆의 .booth.json → 라이브러리 파일 이름(같은/비슷한)</summary>
        public static List<BtmLibrary.Item> ItemsFor(string path, Dictionary<string, string> archived)
        {
            var id = ItemIdFor(path, archived, false);
            if (!string.IsNullOrEmpty(id) && BtmLibrary.ById.TryGetValue(id, out var item)) return new List<BtmLibrary.Item> { item };
            return BtmLibrary.FindByFilePath(path);
        }

        public static string ItemIdFor(string path, Dictionary<string, string> archived) => ItemIdFor(path, archived, true);

        private static string ItemIdFor(string path, Dictionary<string, string> archived, bool byName)
        {
            try
            {
                if (archived != null && archived.TryGetValue(Path.GetFullPath(path), out var id)) return id;
            }
            catch
            {
                // 무시
            }
            var side = BoothFolderIcons.ReadSidecar(path);
            if (!string.IsNullOrEmpty(side?.itemId)) return side.itemId;
            return byName ? BtmLibrary.FindByFileName(Path.GetFileName(path))?.itemId : null;
        }
    }
}
