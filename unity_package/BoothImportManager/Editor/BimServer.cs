using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace BoothImportManager
{
    /// <summary>
    /// 크롬 확장과 이야기하는 작은 로컬 서버 (127.0.0.1:7840~7849 중 빈 포트).
    /// 유니티가 켜져 있는 동안만 응답한다. 파일 대기열이 기준이라 서버가 잠깐 멈춰도(컴파일 등) 놓치는 건 없다.
    /// 크롬 확장(chrome-extension://) 에서 온 요청만 받는다.
    /// </summary>
    [InitializeOnLoad]
    public static class BimServer
    {
        public const int FirstPort = 7840;
        public const int LastPort = 7849;

        private static TcpListener listener;
        private static Thread thread;
        private static volatile bool running;
        public static int Port { get; private set; }

        static BimServer()
        {
            // BimContext 를 메인 스레드에서 먼저 초기화 (서버 스레드에서 처음 건드리면 유니티 API 오류)
            if (string.IsNullOrEmpty(BimContext.ProjectKey)) return;
            Start();
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
        }

        public static void Start()
        {
            if (running) return;
            for (var port = FirstPort; port <= LastPort; port++)
            {
                try
                {
                    var l = new TcpListener(IPAddress.Loopback, port);
                    l.Start();
                    listener = l;
                    Port = port;
                    break;
                }
                catch (SocketException)
                {
                    // 다른 유니티가 쓰는 중 → 다음 포트
                }
            }
            if (listener == null)
            {
                Debug.LogWarning("[BoothImportManager] 7840~7849 포트가 모두 사용 중이라 크롬 확장과 연결할 수 없어요");
                return;
            }
            running = true;
            thread = new Thread(AcceptLoop) { IsBackground = true, Name = "BoothImportManager.Server" };
            thread.Start();
        }

        public static void Stop()
        {
            running = false;
            try { listener?.Stop(); } catch { /* 무시 */ }
            listener = null;
            Port = 0;
        }

        private static void AcceptLoop()
        {
            while (running)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch { if (!running) return; continue; }
                ThreadPool.QueueUserWorkItem(_ => Handle(client));
            }
        }

        // ---- HTTP -------------------------------------------------------------------
        private class Request
        {
            public string Method;
            public string Path;
            public string Origin = "";
            public string Body = "";
        }

        private static void Handle(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 15000;
                    client.SendTimeout = 15000;
                    var stream = client.GetStream();
                    var req = ReadRequest(stream);
                    if (req == null) return;

                    var allowed = string.IsNullOrEmpty(req.Origin) || req.Origin.StartsWith("chrome-extension://", StringComparison.Ordinal);
                    if (!allowed)
                    {
                        Write(stream, 403, "{\"error\":\"origin not allowed\"}", "");
                        return;
                    }
                    if (req.Method == "OPTIONS")
                    {
                        Write(stream, 204, "", req.Origin);
                        return;
                    }
                    int status;
                    string body;
                    try
                    {
                        body = Route(req, out status);
                    }
                    catch (Exception e)
                    {
                        status = 500;
                        body = "{\"error\":" + Quote(e.Message) + "}";
                    }
                    Write(stream, status, body, req.Origin);
                }
                catch
                {
                    // 연결 끊김 등은 무시
                }
            }
        }

        private static Request ReadRequest(NetworkStream stream)
        {
            var header = new MemoryStream();
            var last4 = 0;
            while (true)
            {
                var b = stream.ReadByte();
                if (b < 0) return null;
                header.WriteByte((byte)b);
                last4 = (last4 << 8) | b;
                if (last4 == 0x0d0a0d0a) break;
                if (header.Length > 32768) return null;
            }
            var lines = Encoding.ASCII.GetString(header.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
            var first = lines[0].Split(' ');
            if (first.Length < 2) return null;
            var req = new Request { Method = first[0].ToUpperInvariant(), Path = first[1] };
            var length = 0;
            for (var i = 1; i < lines.Length; i++)
            {
                var idx = lines[i].IndexOf(':');
                if (idx <= 0) continue;
                var name = lines[i].Substring(0, idx).Trim().ToLowerInvariant();
                var value = lines[i].Substring(idx + 1).Trim();
                if (name == "content-length") int.TryParse(value, out length);
                else if (name == "origin") req.Origin = value;
            }
            if (length > 0)
            {
                if (length > 4 * 1024 * 1024) return null;
                var buf = new byte[length];
                var read = 0;
                while (read < length)
                {
                    var n = stream.Read(buf, read, length - read);
                    if (n <= 0) break;
                    read += n;
                }
                req.Body = Encoding.UTF8.GetString(buf, 0, read);
            }
            return req;
        }

        private static void Write(NetworkStream stream, int status, string body, string origin)
        {
            var bytes = Encoding.UTF8.GetBytes(body ?? "");
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(status == 200 ? "OK" : status == 204 ? "No Content" : "Error").Append("\r\n");
            sb.Append("Content-Type: application/json; charset=utf-8\r\n");
            sb.Append("Content-Length: ").Append(bytes.Length).Append("\r\n");
            sb.Append("Cache-Control: no-store\r\n");
            if (!string.IsNullOrEmpty(origin))
            {
                sb.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\n");
                sb.Append("Vary: Origin\r\n");
                sb.Append("Access-Control-Allow-Headers: Content-Type\r\n");
                sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
                sb.Append("Access-Control-Allow-Private-Network: true\r\n");
            }
            sb.Append("Connection: close\r\n\r\n");
            var head = Encoding.ASCII.GetBytes(sb.ToString());
            stream.Write(head, 0, head.Length);
            if (bytes.Length > 0) stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }

        private static string Quote(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder("\"");
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        // ---- 요청/응답 형태 ---------------------------------------------------------------
        [Serializable]
        private class PingResponse
        {
            public string app = "bim-unity";
            public string version = BimContext.Version;
            public string key;
            public string name;
            public string path;
            public string unityVersion;
            public int port;
            public string queueRoot;
            public string archiveDir;
            public bool keepArchive;
            public string chromeDownloads;
            public bool busy;
            public string current;
            public int pending;
            public bool autoImport;
            public string lastLog;
        }

        [Serializable] private class ConfigRequest { public string queueRoot; public string archiveDir; public bool keepArchive = true; public bool setQueueRoot; public bool setArchiveDir; public bool setKeepArchive; }
        [Serializable] private class ScanRequest { public string[] roots; public string[] extra; }
        [Serializable] private class ScanResponse { public List<BimProjects.ProjectInfo> projects; }
        [Serializable] private class SuggestResponse { public List<BimProjects.Suggestion> items; }
        [Serializable] private class JobRef { public string jobId; public string project; }
        [Serializable] private class JobsRequest { public JobRef[] jobs; }
        [Serializable] private class JobsResponse { public List<BimJobRunner.Result> items = new List<BimJobRunner.Result>(); }
        [Serializable] private class RequeueRequest { public string archivedPath; public BimJobRunner.Job job; }
        [Serializable] private class PathRequest { public string path; public string initial; public string title; }
        [Serializable] private class PathResponse { public string path; public string result; }

        private static PingResponse Ping()
        {
            var shared = BimContext.ReadShared();
            return new PingResponse
            {
                key = BimContext.ProjectKey,
                name = BimContext.ProjectName,
                path = BimContext.ProjectPath,
                unityVersion = BimContext.UnityVersion,
                port = Port,
                queueRoot = BimContext.QueueRoot,
                archiveDir = BimContext.ArchiveDir,
                keepArchive = shared.keepArchive,
                chromeDownloads = BimContext.ChromeDownloadsDir(),
                busy = BimJobRunner.Busy,
                current = BimJobRunner.CurrentFile,
                pending = BimJobRunner.PendingCount,
                autoImport = autoImportCache,
                lastLog = BimJobRunner.LastLog,
            };
        }

        private static bool autoImportCache = true;

        [InitializeOnLoadMethod]
        private static void CacheSettings()
        {
            EditorApplication.update += () => autoImportCache = BoothImportSettings.instance.AutoImport;
        }

        private static string Route(Request req, out int status)
        {
            status = 200;
            var path = req.Path;
            var q = path.IndexOf('?');
            if (q >= 0) path = path.Substring(0, q);

            switch (path)
            {
                case "/bim/ping":
                    return JsonUtility.ToJson(Ping());

                case "/bim/config":
                {
                    var r = JsonUtility.FromJson<ConfigRequest>(Body(req));
                    var shared = BimContext.ReadShared();
                    if (r.setQueueRoot) shared.queueRoot = (r.queueRoot ?? "").Trim();
                    if (r.setArchiveDir) shared.archiveDir = (r.archiveDir ?? "").Trim();
                    if (r.setKeepArchive) shared.keepArchive = r.keepArchive;
                    BimContext.WriteShared(shared);
                    BimJobRunner.ScanNow();
                    return JsonUtility.ToJson(Ping());
                }

                case "/bim/scan":
                {
                    var r = JsonUtility.FromJson<ScanRequest>(Body(req));
                    return JsonUtility.ToJson(new ScanResponse { projects = BimProjects.Scan(r.roots, r.extra) });
                }

                case "/bim/suggest":
                    return JsonUtility.ToJson(new SuggestResponse { items = BimProjects.Suggest() });

                case "/bim/jobs":
                {
                    var r = JsonUtility.FromJson<JobsRequest>(Body(req));
                    var res = new JobsResponse();
                    foreach (var j in r.jobs ?? Array.Empty<JobRef>())
                        if (!string.IsNullOrEmpty(j?.jobId)) res.items.Add(BimJobRunner.Status(j.jobId, j.project));
                    return JsonUtility.ToJson(res);
                }

                case "/bim/cancel":
                {
                    var r = JsonUtility.FromJson<JobRef>(Body(req));
                    return JsonUtility.ToJson(new PathResponse { result = BimJobRunner.Cancel(r.jobId, r.project) });
                }

                case "/bim/requeue":
                {
                    var r = JsonUtility.FromJson<RequeueRequest>(Body(req));
                    BimJobRunner.Requeue(r.archivedPath, r.job);
                    return JsonUtility.ToJson(new PathResponse { result = "queued" });
                }

                case "/bim/pick-folder":
                {
                    var r = JsonUtility.FromJson<PathRequest>(Body(req));
                    var picked = BimContext.RunOnMain(() =>
                    {
                        FocusUnity();
                        return EditorUtility.OpenFolderPanel(string.IsNullOrEmpty(r.title) ? "폴더 선택" : r.title, r.initial ?? "", "");
                    }, 10 * 60 * 1000);
                    return JsonUtility.ToJson(new PathResponse { path = picked ?? "" });
                }

                case "/bim/reveal":
                {
                    var r = JsonUtility.FromJson<PathRequest>(Body(req));
                    if (string.IsNullOrEmpty(r.path)) throw new ArgumentException("경로가 없어요");
                    Directory.CreateDirectory(r.path);
                    BimContext.Post(() => EditorUtility.RevealInFinder(r.path));
                    return JsonUtility.ToJson(new PathResponse { path = r.path, result = "ok" });
                }

                case "/bim/scan-queue":
                    BimJobRunner.ScanNow();
                    return "{\"result\":\"ok\"}";

                default:
                    status = 404;
                    return "{\"error\":\"not found\"}";
            }
        }

        private static string Body(Request req) => string.IsNullOrEmpty(req.Body) ? "{}" : req.Body;

        private static void FocusUnity()
        {
            try { EditorUtility.FocusProjectWindow(); }
            catch { /* 무시 */ }
        }
    }
}
