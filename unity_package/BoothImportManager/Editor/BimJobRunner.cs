using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

namespace BoothImportManager
{
    /// <summary>
    /// 크롬 확장이 다운로드 폴더에 넣어둔 작업(대기열\&lt;이 프로젝트 키&gt;\&lt;작업&gt;\job.json)을 하나씩 처리한다.
    ///  1. 준비 (백그라운드): 썸네일 받기, zip 이면 풀기
    ///  2. 임포트: 안의 .unitypackage 를 차례로 임포트 (BoothPackageImporter)
    ///  3. 마무리: 결과 기록(_bim\done), 원본은 보관 폴더로, 작업 폴더 정리
    /// 진행 상태는 Temp 에 저장해서 스크립트 리로드(컴파일) 뒤에도 이어서 한다.
    /// </summary>
    [InitializeOnLoad]
    public static class BimJobRunner
    {
        private const string StateFile = "Temp/BoothImportManager_job.json";
        private const string JobFileName = "job.json";
        private const string LockFileName = "importing.lock";

        [Serializable]
        public class Job
        {
            public string jobId;
            public string project;
            public string tag;
            public string assetRoot;
            public string filename;
            public string downloadableId;
            public string itemId;
            public string itemName;
            public string itemUrl;
            public string shopName;
            public string shopUrl;
            public string itemThumbUrl;
            public string shopIconUrl;
            public string fileLabel;
            public double createdAt;
        }

        [Serializable]
        public class Result
        {
            public string jobId;
            public string project;
            public string projectName;
            public string tag;
            public string state;      // imported | failed | no_package | queued | importing | unknown
            public string error;
            public string filename;
            public string archivedPath;
            public string itemId;
            public string itemName;
            public string downloadableId;
            public string[] importedTo;
            public double finishedAt;
        }

        [Serializable]
        private class State
        {
            public Job job;
            public string jobDir;
            public string source;
            public string phase;       // prepare | import
            public string[] packages;
            public int index;
            public string extractDir;
            public bool legacy;
            public BoothFolderIcons.BoothMeta meta;
            public List<string> errors = new List<string>();
            public List<string> importedTo = new List<string>();
        }

        private static State state;
        private static bool loaded;
        private static Task<List<string>> prepareTask;
        private static double nextScan;
        private static int pendingCount;
        private static string lastLog = "";

        public static string CurrentFile => state?.job?.filename ?? "";
        public static string CurrentJobId => state?.job?.jobId ?? "";
        public static int PendingCount => pendingCount;
        public static string LastLog => lastLog;
        public static bool Busy => state != null || BoothPackageImporter.HasPending;

        static BimJobRunner()
        {
            var _ = BimContext.ProjectKey; // 메인 스레드에서 먼저 초기화
            EnsureLoaded();
            EditorApplication.update += Update;
        }

        // ---- 상태 저장 ----------------------------------------------------------
        private static void EnsureLoaded()
        {
            if (loaded) return;
            loaded = true;
            try
            {
                if (File.Exists(StateFile)) state = JsonUtility.FromJson<State>(File.ReadAllText(StateFile, Encoding.UTF8));
                if (state?.job == null) state = null;
            }
            catch
            {
                state = null;
            }
        }

        private static void Save()
        {
            try
            {
                if (state == null)
                {
                    if (File.Exists(StateFile)) File.Delete(StateFile);
                    return;
                }
                File.WriteAllText(StateFile, JsonUtility.ToJson(state), Encoding.UTF8);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BoothImportManager] 진행 상태 저장 실패: {e.Message}");
            }
        }

        private static void Log(string text)
        {
            lastLog = text;
            Debug.Log($"[BoothImportManager] {text}");
        }

        // ---- 루프 -----------------------------------------------------------------
        private static void Update()
        {
            if (!BoothImportSettings.instance.AutoImport) return;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (BoothPackageImporter.HasPending) return;

            if (state != null)
            {
                Advance();
                return;
            }
            if (EditorApplication.timeSinceStartup < nextScan) return;
            nextScan = EditorApplication.timeSinceStartup + 2.0;
            try
            {
                var next = FindNext();
                if (next != null) Begin(next);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BoothImportManager] 대기열 확인 실패: {e.Message}");
            }
        }

        public static void ScanNow() => nextScan = 0;

        private class Candidate
        {
            public Job job;
            public string dir;
            public string source;
            public bool legacy;
        }

        private static Job ReadJob(string file)
        {
            try { return JsonUtility.FromJson<Job>(File.ReadAllText(file, Encoding.UTF8)); }
            catch { return null; }
        }

        private static Candidate FindNext()
        {
            var list = new List<Candidate>();
            var dir = BimContext.MyQueueDir;
            if (Directory.Exists(dir))
            {
                foreach (var jobDir in Directory.GetDirectories(dir))
                {
                    var jobFile = Path.Combine(jobDir, JobFileName);
                    if (!File.Exists(jobFile)) continue;
                    var job = ReadJob(jobFile);
                    if (job == null || string.IsNullOrEmpty(job.filename)) continue;
                    if (string.IsNullOrEmpty(job.jobId)) job.jobId = Path.GetFileName(jobDir);
                    list.Add(new Candidate { job = job, dir = jobDir, source = Path.Combine(jobDir, job.filename) });
                }
            }
            if (BoothImportSettings.instance.WatchLegacyQueue) list.AddRange(LegacyCandidates());
            pendingCount = list.Count;

            foreach (var c in list.OrderBy(c => c.job.createdAt))
            {
                if (File.Exists(c.source) && IsReady(c.source)) return c;
                if (c.legacy) continue;
                // 아직 내려받는 중이면 기다리고, 오래됐는데 파일이 없으면 실패 처리
                var downloading = Directory.GetFiles(c.dir).Any(f => f.EndsWith(".crdownload", StringComparison.OrdinalIgnoreCase));
                var age = BimContext.Now - (c.job.createdAt > 0 ? c.job.createdAt : BimContext.Now);
                if (!downloading && !File.Exists(c.source) && age > 600)
                {
                    WriteResult(c.job, "failed", "받은 파일이 대기열 폴더에 없어요", null, null);
                    BimContext.TryDeleteDir(c.dir);
                }
            }
            return null;
        }

        private static bool IsReady(string path)
        {
            try
            {
                using (var s = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                    return s.Length > 0;
            }
            catch
            {
                return false;
            }
        }

        // v0.3 로컬 앱이 남긴 대기열 (보관폴더\_projects\키\태그\*.unitypackage)
        [Serializable] private class Bridge { public string intakeFolder; }

        private static List<Candidate> LegacyCandidates()
        {
            var result = new List<Candidate>();
            string intake = null;
            try
            {
                var file = Path.Combine(BimContext.SharedDir, "bridge.json");
                if (File.Exists(file)) intake = JsonUtility.FromJson<Bridge>(File.ReadAllText(file))?.intakeFolder;
            }
            catch
            {
                intake = null;
            }
            if (string.IsNullOrEmpty(intake)) return result;
            var dir = Path.Combine(intake, "_projects", BimContext.ProjectKey);
            if (!Directory.Exists(dir)) return result;
            string[] files;
            try { files = Directory.GetFiles(dir, "*.unitypackage", SearchOption.AllDirectories); }
            catch { return result; }
            foreach (var f in files)
            {
                var tag = Path.GetFileName(Path.GetDirectoryName(f)) ?? "태그 없음";
                var meta = BoothFolderIcons.ReadSidecar(f);
                result.Add(new Candidate
                {
                    legacy = true,
                    dir = Path.GetDirectoryName(f),
                    source = f,
                    job = new Job
                    {
                        jobId = "legacy_" + Path.GetFileNameWithoutExtension(f),
                        project = BimContext.ProjectKey,
                        tag = tag,
                        assetRoot = LegacyAssetRoot(dir),
                        filename = Path.GetFileName(f),
                        itemId = meta?.itemId ?? "",
                        itemName = meta?.itemName ?? "",
                        itemUrl = meta?.itemUrl ?? "",
                        shopName = meta?.shopName ?? "",
                        shopUrl = meta?.shopUrl ?? "",
                        createdAt = new DateTimeOffset(File.GetLastWriteTimeUtc(f)).ToUnixTimeSeconds(),
                    },
                });
            }
            return result;
        }

        [Serializable] private class LegacyProject { public string assetRoot; }

        private static string LegacyAssetRoot(string dir)
        {
            try
            {
                var file = Path.Combine(dir, "project.json");
                if (File.Exists(file)) return JsonUtility.FromJson<LegacyProject>(File.ReadAllText(file))?.assetRoot ?? "";
            }
            catch
            {
                // 무시
            }
            return "";
        }

        // ---- 처리 -----------------------------------------------------------------
        private static BoothFolderIcons.BoothMeta MetaFrom(Job job) => new BoothFolderIcons.BoothMeta
        {
            itemId = job.itemId,
            itemName = job.itemName,
            itemUrl = job.itemUrl,
            shopName = job.shopName,
            shopUrl = job.shopUrl,
            itemThumbUrl = job.itemThumbUrl,
            shopIconUrl = job.shopIconUrl,
            fileLabel = job.fileLabel,
            packageName = Path.GetFileNameWithoutExtension(job.filename),
        };

        private static void Begin(Candidate c)
        {
            state = new State
            {
                job = c.job,
                jobDir = c.dir,
                source = c.source,
                phase = "prepare",
                legacy = c.legacy,
                meta = c.legacy ? (BoothFolderIcons.ReadSidecar(c.source) ?? MetaFrom(c.job)) : MetaFrom(c.job),
            };
            if (!c.legacy)
            {
                try { File.WriteAllText(Path.Combine(c.dir, LockFileName), BimContext.Now.ToString("F0")); }
                catch { /* 표시용 */ }
            }
            Save();
            Log($"처리 시작: {c.job.filename} → {c.job.tag}");
            StartPrepare();
        }

        private static void StartPrepare()
        {
            var source = state.source;
            var meta = state.meta;
            var extractDir = Path.Combine(BimContext.ExtractRoot, BimContext.SafeFileName(state.job.jobId, "job"));
            state.extractDir = extractDir;
            prepareTask = Task.Run(() =>
            {
                try { BimNet.EnsureThumbs(meta); }
                catch { /* 아이콘은 없어도 됨 */ }

                if (source.EndsWith(".unitypackage", StringComparison.OrdinalIgnoreCase))
                    return new List<string> { source };
                if (!BimZip.IsZip(source)) return new List<string>();
                if (Directory.Exists(extractDir)) Directory.Delete(extractDir, true);
                var files = BimZip.Extract(source, extractDir);
                return files.Where(f => f.EndsWith(".unitypackage", StringComparison.OrdinalIgnoreCase))
                    .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                    .ToList();
            });
        }

        private static void Advance()
        {
            if (state.phase == "prepare")
            {
                if (prepareTask == null)
                {
                    // 리로드로 준비 작업이 끊겼으면 처음부터 다시
                    StartPrepare();
                    return;
                }
                if (!prepareTask.IsCompleted) return;
                var task = prepareTask;
                prepareTask = null;
                if (task.IsFaulted || task.IsCanceled)
                {
                    var error = task.Exception?.GetBaseException().Message ?? "준비 중 오류";
                    Finish("failed", error);
                    return;
                }
                state.packages = task.Result.ToArray();
                if (state.packages.Length == 0)
                {
                    Finish("no_package", "안에 .unitypackage 가 없어요");
                    return;
                }
                state.phase = "import";
                state.index = 0;
                Save();
            }

            if (state.phase == "import")
            {
                if (state.index < state.packages.Length)
                {
                    var pkg = state.packages[state.index];
                    Log($"임포트 ({state.index + 1}/{state.packages.Length}): {Path.GetFileName(pkg)}");
                    BoothPackageImporter.ImportPackage(pkg, state.job.tag, state.job.assetRoot, state.meta);
                    return;
                }
                var failedAll = state.errors.Count >= state.packages.Length;
                Finish(failedAll ? "failed" : "imported", state.errors.Count > 0 ? string.Join(" / ", state.errors) : null);
            }
        }

        /// <summary>패키지 하나 임포트가 끝나면 BoothPackageImporter 가 부른다.</summary>
        public static void PackageFinished(bool ok, string error, string targetRoot)
        {
            EnsureLoaded();
            if (state == null) return;
            var pkg = state.packages != null && state.index < state.packages.Length ? Path.GetFileName(state.packages[state.index]) : "";
            if (ok) { if (!string.IsNullOrEmpty(targetRoot) && !state.importedTo.Contains(targetRoot)) state.importedTo.Add(targetRoot); }
            else state.errors.Add($"{pkg}: {error}");
            state.index++;
            Save();
        }

        private static void Finish(string result, string error)
        {
            var job = state.job;
            string archived = null;
            try
            {
                if (File.Exists(state.source))
                {
                    if (state.legacy)
                    {
                        File.Delete(state.source);
                        if (File.Exists(state.source + ".booth.json")) File.Delete(state.source + ".booth.json");
                    }
                    else if (BimContext.ReadShared().keepArchive)
                    {
                        var dir = BimContext.ArchiveDir;
                        Directory.CreateDirectory(dir);
                        archived = BimContext.UniquePath(Path.Combine(dir, job.filename));
                        File.Move(state.source, archived);
                    }
                    else
                    {
                        File.Delete(state.source);
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BoothImportManager] 원본 정리 실패: {e.Message}");
            }

            if (!state.legacy) WriteResult(job, result, error, archived, state.importedTo.ToArray());
            BimContext.TryDeleteDir(state.extractDir);
            if (!state.legacy) BimContext.TryDeleteDir(state.jobDir);

            var label = result == "imported" ? "임포트 완료" : result == "no_package" ? "패키지 없음" : "실패";
            Log($"{label}: {job.filename}{(string.IsNullOrEmpty(error) ? "" : " — " + error)}");
            state = null;
            Save();
            nextScan = 0;
        }

        private static void WriteResult(Job job, string result, string error, string archived, string[] importedTo)
        {
            try
            {
                Directory.CreateDirectory(BimContext.DoneDir);
                var r = new Result
                {
                    jobId = job.jobId,
                    project = BimContext.ProjectKey,
                    projectName = BimContext.ProjectName,
                    tag = job.tag,
                    state = result,
                    error = error ?? "",
                    filename = job.filename,
                    archivedPath = archived ?? "",
                    itemId = job.itemId,
                    itemName = job.itemName,
                    downloadableId = job.downloadableId,
                    importedTo = importedTo ?? Array.Empty<string>(),
                    finishedAt = BimContext.Now,
                };
                File.WriteAllText(Path.Combine(BimContext.DoneDir, BimContext.SafeFileName(job.jobId, "job") + ".json"), JsonUtility.ToJson(r, true), Encoding.UTF8);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[BoothImportManager] 결과 기록 실패: {e.Message}");
            }
        }

        // ---- 서버에서 부르는 것 (백그라운드 스레드) ------------------------------------
        public static Result Status(string jobId, string project)
        {
            var safe = BimContext.SafeFileName(jobId, "job");
            var done = Path.Combine(BimContext.DoneDir, safe + ".json");
            if (File.Exists(done))
            {
                try { return JsonUtility.FromJson<Result>(File.ReadAllText(done, Encoding.UTF8)); }
                catch { /* 아래로 */ }
            }
            if (!string.IsNullOrEmpty(project))
            {
                var dir = Path.Combine(BimContext.QueueDir, BimContext.SafeFileName(project, "_"), safe);
                if (Directory.Exists(dir))
                    return new Result { jobId = jobId, project = project, state = File.Exists(Path.Combine(dir, LockFileName)) ? "importing" : "queued" };
            }
            return new Result { jobId = jobId, project = project, state = "unknown" };
        }

        public static string Cancel(string jobId, string project)
        {
            var dir = Path.Combine(BimContext.QueueDir, BimContext.SafeFileName(project, "_"), BimContext.SafeFileName(jobId, "job"));
            if (!Directory.Exists(dir)) return "gone";
            var lockFile = Path.Combine(dir, LockFileName);
            if (File.Exists(lockFile) && (DateTime.UtcNow - File.GetLastWriteTimeUtc(lockFile)).TotalHours < 2)
                throw new InvalidOperationException("이미 임포트 중이라 취소할 수 없어요");
            Directory.Delete(dir, true);
            return "cancelled";
        }

        /// <summary>보관 폴더의 파일을 다시 대기열로 (다른 프로젝트로 또 보낼 때)</summary>
        public static void Requeue(string archivedPath, Job job)
        {
            if (string.IsNullOrEmpty(archivedPath) || !File.Exists(archivedPath)) throw new FileNotFoundException("보관 폴더에 원본이 없어요");
            if (string.IsNullOrEmpty(job?.jobId) || string.IsNullOrEmpty(job.project)) throw new ArgumentException("작업 정보가 없어요");
            var dir = Path.Combine(BimContext.QueueDir, BimContext.SafeFileName(job.project, "_"), BimContext.SafeFileName(job.jobId, "job"));
            Directory.CreateDirectory(dir);
            job.filename = BimContext.SafeFileName(string.IsNullOrEmpty(job.filename) ? Path.GetFileName(archivedPath) : job.filename);
            var tmp = Path.Combine(dir, job.filename + ".part");
            File.Copy(archivedPath, tmp, true);
            File.Move(tmp, Path.Combine(dir, job.filename));
            if (job.createdAt <= 0) job.createdAt = BimContext.Now;
            File.WriteAllText(Path.Combine(dir, JobFileName), JsonUtility.ToJson(job, true), Encoding.UTF8);
        }
    }
}
