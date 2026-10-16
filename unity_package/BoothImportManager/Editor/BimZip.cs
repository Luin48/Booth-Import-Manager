using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace BoothImportManager
{
    /// <summary>
    /// 부스 zip 해제기. 직접 중앙 디렉터리를 읽어서
    ///  - 파일 이름 바이트를 그대로 받아 UTF-8 → Shift_JIS(일본) → CP949(한국) 순으로 해석하고
    ///  - ZIP64(4GB 넘는 파일)도 처리하고
    ///  - zip slip(../ 경로) 을 막는다.
    /// 백그라운드 스레드에서 호출해도 된다 (유니티 API 사용 안 함).
    /// </summary>
    public static class BimZip
    {
        private class Entry
        {
            public string Name;
            public ushort Flags;
            public ushort Method;
            public long CompressedSize;
            public long Size;
            public long LocalOffset;
        }

        public static bool IsZip(string path)
        {
            try
            {
                using (var fs = File.OpenRead(path))
                {
                    var sig = new byte[4];
                    return fs.Read(sig, 0, 4) == 4 && sig[0] == 0x50 && sig[1] == 0x4b && (sig[2] == 3 || sig[2] == 5 || sig[2] == 7) ;
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>zip 을 dest 에 풀고, 풀린 파일 경로 목록을 돌려준다. cancel 이 true 가 되면 중단.</summary>
        public static List<string> Extract(string zipPath, string dest, Func<bool> cancel = null)
        {
            var output = new List<string>();
            Directory.CreateDirectory(dest);
            var root = Path.GetFullPath(dest).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            using (var fs = new FileStream(zipPath, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
            {
                var entries = ReadCentralDirectory(fs);
                var buffer = new byte[1 << 16];
                foreach (var e in entries)
                {
                    if (cancel != null && cancel()) throw new OperationCanceledException();
                    var rel = e.Name.Replace('\\', '/').TrimStart('/');
                    if (string.IsNullOrEmpty(rel)) continue;
                    var parts = new List<string>();
                    foreach (var p in rel.Split('/'))
                    {
                        if (p == "" || p == ".") continue;
                        if (p == "..") { parts.Clear(); break; } // zip slip — 건너뜀
                        parts.Add(BimContext.SafeFileName(p, "_"));
                    }
                    if (parts.Count == 0) continue;
                    var target = Path.GetFullPath(Path.Combine(root, Path.Combine(parts.ToArray())));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                    if (rel.EndsWith("/"))
                    {
                        Directory.CreateDirectory(target);
                        continue;
                    }
                    if ((e.Flags & 1) != 0) throw new IOException($"암호가 걸린 zip이라 풀 수 없어요: {rel}");
                    if (e.Method != 0 && e.Method != 8) throw new IOException($"지원하지 않는 압축 방식({e.Method})이에요: {rel}");

                    Directory.CreateDirectory(Path.GetDirectoryName(target) ?? root);
                    var dataStart = LocalDataStart(fs, e);
                    fs.Position = dataStart;
                    using (var outFile = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16))
                    {
                        Stream src = new SubStream(fs, dataStart, e.CompressedSize);
                        if (e.Method == 8) src = new DeflateStream(src, CompressionMode.Decompress, true);
                        int read;
                        while ((read = src.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            outFile.Write(buffer, 0, read);
                            if (cancel != null && cancel()) throw new OperationCanceledException();
                        }
                        if (e.Method == 8) src.Dispose();
                    }
                    output.Add(target);
                }
            }
            return output;
        }

        // ---- 이름 해석 -------------------------------------------------------------
        private static readonly Encoding StrictUtf8 = new UTF8Encoding(false, true);

        private static Encoding Strict(int codepage)
        {
            try { return Encoding.GetEncoding(codepage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback); }
            catch { return null; }
        }

        private static Encoding sjis;
        private static Encoding cp949;
        private static bool encodingsLoaded;

        public static string DecodeName(byte[] raw, bool utf8Flag)
        {
            if (utf8Flag) return Encoding.UTF8.GetString(raw);
            var ascii = true;
            foreach (var b in raw) if (b >= 0x80) { ascii = false; break; }
            if (ascii) return Encoding.ASCII.GetString(raw);
            try { return StrictUtf8.GetString(raw); } catch { /* 다음 후보 */ }
            if (!encodingsLoaded)
            {
                encodingsLoaded = true;
                sjis = Strict(932);
                cp949 = Strict(949);
            }
            if (sjis != null) { try { return sjis.GetString(raw); } catch { /* 다음 후보 */ } }
            if (cp949 != null) { try { return cp949.GetString(raw); } catch { /* 다음 후보 */ } }
            try { return Encoding.GetEncoding(932).GetString(raw); } catch { return Encoding.GetEncoding(28591).GetString(raw); }
        }

        // ---- 구조 읽기 -------------------------------------------------------------
        private static List<Entry> ReadCentralDirectory(FileStream fs)
        {
            var len = fs.Length;
            var tailLen = (int)Math.Min(len, 65536 + 22);
            var tail = new byte[tailLen];
            fs.Position = len - tailLen;
            ReadExactly(fs, tail, tailLen);
            var eocd = -1;
            for (var i = tailLen - 22; i >= 0; i--)
            {
                if (tail[i] == 0x50 && tail[i + 1] == 0x4b && tail[i + 2] == 5 && tail[i + 3] == 6) { eocd = i; break; }
            }
            if (eocd < 0) throw new IOException("zip 파일이 아니거나 손상됐어요 (끝부분 없음)");

            long count = BitConverter.ToUInt16(tail, eocd + 10);
            long cdSize = BitConverter.ToUInt32(tail, eocd + 12);
            long cdOffset = BitConverter.ToUInt32(tail, eocd + 16);

            // ZIP64
            if (count == 0xFFFF || cdSize == 0xFFFFFFFF || cdOffset == 0xFFFFFFFF)
            {
                var loc = eocd - 20;
                if (loc >= 0 && tail[loc] == 0x50 && tail[loc + 1] == 0x4b && tail[loc + 2] == 6 && tail[loc + 3] == 7)
                {
                    var eocd64Offset = (long)BitConverter.ToUInt64(tail, loc + 8);
                    var rec = new byte[56];
                    fs.Position = eocd64Offset;
                    ReadExactly(fs, rec, 56);
                    if (BitConverter.ToUInt32(rec, 0) != 0x06064b50) throw new IOException("ZIP64 정보가 손상됐어요");
                    count = (long)BitConverter.ToUInt64(rec, 32);
                    cdSize = (long)BitConverter.ToUInt64(rec, 40);
                    cdOffset = (long)BitConverter.ToUInt64(rec, 48);
                }
            }

            if (cdSize > int.MaxValue) throw new IOException("zip 목록이 너무 커요");
            var cd = new byte[cdSize];
            fs.Position = cdOffset;
            ReadExactly(fs, cd, (int)cdSize);

            var list = new List<Entry>();
            var p = 0;
            for (long n = 0; n < count && p + 46 <= cd.Length; n++)
            {
                if (BitConverter.ToUInt32(cd, p) != 0x02014b50) throw new IOException("zip 목록이 손상됐어요");
                var flags = BitConverter.ToUInt16(cd, p + 8);
                var method = BitConverter.ToUInt16(cd, p + 10);
                long csize = BitConverter.ToUInt32(cd, p + 20);
                long usize = BitConverter.ToUInt32(cd, p + 24);
                int nameLen = BitConverter.ToUInt16(cd, p + 28);
                int extraLen = BitConverter.ToUInt16(cd, p + 30);
                int commentLen = BitConverter.ToUInt16(cd, p + 32);
                long offset = BitConverter.ToUInt32(cd, p + 42);

                var nameBytes = new byte[nameLen];
                Buffer.BlockCopy(cd, p + 46, nameBytes, 0, nameLen);
                string name = null;

                // extra: 0x0001 = ZIP64 크기/위치, 0x7075 = 유니코드 경로
                var x = p + 46 + nameLen;
                var xEnd = x + extraLen;
                while (x + 4 <= xEnd)
                {
                    var id = BitConverter.ToUInt16(cd, x);
                    var size = BitConverter.ToUInt16(cd, x + 2);
                    var d = x + 4;
                    if (id == 0x0001)
                    {
                        if (usize == 0xFFFFFFFF && d + 8 <= xEnd) { usize = (long)BitConverter.ToUInt64(cd, d); d += 8; }
                        if (csize == 0xFFFFFFFF && d + 8 <= xEnd) { csize = (long)BitConverter.ToUInt64(cd, d); d += 8; }
                        if (offset == 0xFFFFFFFF && d + 8 <= xEnd) { offset = (long)BitConverter.ToUInt64(cd, d); }
                    }
                    else if (id == 0x7075 && size > 5)
                    {
                        try { name = Encoding.UTF8.GetString(cd, d + 5, size - 5); } catch { name = null; }
                    }
                    x += 4 + size;
                }

                list.Add(new Entry
                {
                    Name = name ?? DecodeName(nameBytes, (flags & 0x800) != 0),
                    Flags = flags,
                    Method = method,
                    CompressedSize = csize,
                    Size = usize,
                    LocalOffset = offset,
                });
                p += 46 + nameLen + extraLen + commentLen;
            }
            return list;
        }

        private static long LocalDataStart(FileStream fs, Entry e)
        {
            var header = new byte[30];
            fs.Position = e.LocalOffset;
            ReadExactly(fs, header, 30);
            if (BitConverter.ToUInt32(header, 0) != 0x04034b50) throw new IOException($"zip 항목이 손상됐어요: {e.Name}");
            int nameLen = BitConverter.ToUInt16(header, 26);
            int extraLen = BitConverter.ToUInt16(header, 28);
            return e.LocalOffset + 30 + nameLen + extraLen;
        }

        private static void ReadExactly(Stream s, byte[] buffer, int count)
        {
            var offset = 0;
            while (offset < count)
            {
                var read = s.Read(buffer, offset, count - offset);
                if (read <= 0) throw new EndOfStreamException("zip 파일이 중간에 끊겼어요");
                offset += read;
            }
        }

        /// <summary>원본 스트림의 일부만 읽게 하는 래퍼</summary>
        private class SubStream : Stream
        {
            private readonly Stream inner;
            private readonly long start;
            private readonly long length;
            private long pos;

            public SubStream(Stream inner, long start, long length)
            {
                this.inner = inner;
                this.start = start;
                this.length = length;
            }

            public override bool CanRead => true;
            public override bool CanSeek => false;
            public override bool CanWrite => false;
            public override long Length => length;
            public override long Position { get => pos; set => throw new NotSupportedException(); }
            public override void Flush() { }
            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
            public override void SetLength(long value) => throw new NotSupportedException();
            public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

            public override int Read(byte[] buffer, int offset, int count)
            {
                var remaining = length - pos;
                if (remaining <= 0) return 0;
                if (count > remaining) count = (int)remaining;
                inner.Position = start + pos;
                var read = inner.Read(buffer, offset, count);
                pos += read;
                return read;
            }
        }
    }
}
