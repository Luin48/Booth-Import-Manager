using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using BoothImportManager;
using UnityEngine;

namespace BoothThumbnailMatcher
{
    /// <summary>창에 보여줄 라이브러리 썸네일 (받아서 공용 캐시에 저장, 동시에 4개까지)</summary>
    public static class BtmThumbs
    {
        private static readonly Dictionary<string, Texture2D> Textures = new Dictionary<string, Texture2D>();
        private static readonly HashSet<string> Pending = new HashSet<string>();
        private static readonly ConcurrentQueue<(string id, string url)> Queue = new ConcurrentQueue<(string, string)>();
        private static int workers;
        public static Action Repaint;

        public static Texture2D Get(BtmLibrary.Item item)
        {
            if (item == null || string.IsNullOrEmpty(item.itemId)) return null;
            if (Textures.TryGetValue(item.itemId, out var tex) && tex != null) return tex;
            if (Pending.Contains(item.itemId)) return null;
            var url = item.thumbnail ?? "";
            if (!url.StartsWith("http")) return null;
            Pending.Add(item.itemId);
            Queue.Enqueue((item.itemId, url));
            Pump();
            return null;
        }

        private static void Pump()
        {
            while (workers < 4 && !Queue.IsEmpty)
            {
                Interlocked.Increment(ref workers);
                Task.Run(() =>
                {
                    try
                    {
                        while (Queue.TryDequeue(out var job))
                        {
                            var path = BimNet.CacheImage(job.url, "lib_" + job.id);
                            var id = job.id;
                            BimContext.Post(() => Load(id, path));
                        }
                    }
                    finally
                    {
                        Interlocked.Decrement(ref workers);
                    }
                });
            }
        }

        private static void Load(string id, string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return;
            try
            {
                var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave };
                if (!tex.LoadImage(File.ReadAllBytes(path)))
                {
                    UnityEngine.Object.DestroyImmediate(tex);
                    return;
                }
                Textures[id] = tex;
                Repaint?.Invoke();
            }
            catch
            {
                // 무시
            }
        }
    }
}
