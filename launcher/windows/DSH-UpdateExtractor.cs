using System;
using System.ComponentModel;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace DshPortableUpdateExtractor
{
    internal static class Program
    {
        private const uint GenericWrite = 0x40000000;
        private const uint FileShareRead = 0x00000001;
        private const uint CreateAlways = 2;
        private const uint FileAttributeNormal = 0x00000080;
        private const uint FileAttributeDirectory = 0x00000010;
        private const uint InvalidFileAttributes = 0xffffffff;
        private const int ErrorAlreadyExists = 183;

        private static int Main(string[] args)
        {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            if (args.Length != 2)
            {
                Console.Error.WriteLine("Usage: DSH-UpdateExtractor.exe <archive.zip> <destination>");
                return 2;
            }
            try
            {
                Extract(args[0], args[1]);
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                return 1;
            }
        }

        private static void Extract(string archive, string destination)
        {
            if (!File.Exists(archive)) throw new FileNotFoundException("Update component archive is missing.", archive);
            if (Directory.Exists(destination) || File.Exists(destination)) throw new IOException("Update staging destination already exists.");
            EnsureDirectory(destination);
            using (FileStream archiveStream = File.OpenRead(archive))
            using (ZipArchive zip = new ZipArchive(archiveStream, ZipArchiveMode.Read, false))
            {
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string relativePath = SafeEntryPath(entry.FullName);
                    if (String.IsNullOrEmpty(relativePath)) continue;
                    EnsureAllowed(relativePath);
                    string target = destination.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                        + Path.DirectorySeparatorChar + relativePath;
                    if (entry.FullName.EndsWith("/", StringComparison.Ordinal) || entry.FullName.EndsWith("\\", StringComparison.Ordinal))
                    {
                        EnsureDirectory(target);
                        continue;
                    }
                    string parent = ParentDirectory(target);
                    if (!String.IsNullOrEmpty(parent)) EnsureDirectory(parent);
                    using (Stream input = entry.Open())
                    using (FileStream output = CreateOutputFile(target)) input.CopyTo(output);
                }
            }
        }

        private static void EnsureAllowed(string relativePath)
        {
            string normalized = relativePath.Replace('\\', '/');
            if (normalized == "component.json" || normalized == "app" || normalized.StartsWith("app/", StringComparison.Ordinal)) return;
            if (normalized == "licenses") return;
            if (normalized == "licenses/COMPONENTS.json"
                || normalized == "licenses/DeepSeek-Harness-LICENSE.txt"
                || normalized == "licenses/DeepSeek-Harness-THIRD_PARTY_NOTICES.md"
                || normalized == "licenses/pnpm-LICENSE.txt") return;
            throw new InvalidDataException("Update archive entry is not allowed: " + relativePath);
        }

        private static string SafeEntryPath(string value)
        {
            string normalized = (value ?? String.Empty).Replace('\\', '/');
            if (normalized.StartsWith("/", StringComparison.Ordinal) || normalized.IndexOf('\0') >= 0)
                throw new InvalidDataException("Update archive contains an unsafe path.");
            string safe = String.Empty;
            foreach (string segment in normalized.Split('/'))
            {
                if (segment.Length == 0 || segment == ".") continue;
                if (segment == ".." || segment.IndexOf(':') >= 0)
                    throw new InvalidDataException("Update archive contains an unsafe path.");
                safe = safe.Length == 0 ? segment : safe + Path.DirectorySeparatorChar + segment;
            }
            return safe;
        }

        private static void EnsureDirectory(string value)
        {
            string fullPath = IsAbsolutePath(value) ? value : Path.GetFullPath(value);
            string extendedPath = ToExtendedPath(fullPath);
            uint attributes = GetFileAttributesW(extendedPath);
            if (attributes != InvalidFileAttributes)
            {
                if ((attributes & FileAttributeDirectory) != 0) return;
                throw new IOException("A file blocks the update directory: " + fullPath);
            }
            string parent = ParentDirectory(fullPath);
            if (!String.IsNullOrEmpty(parent) && !String.Equals(parent, fullPath, StringComparison.OrdinalIgnoreCase)) EnsureDirectory(parent);
            if (CreateDirectoryW(extendedPath, IntPtr.Zero)) return;
            int error = Marshal.GetLastWin32Error();
            if (error == ErrorAlreadyExists && (GetFileAttributesW(extendedPath) & FileAttributeDirectory) != 0) return;
            throw new IOException("Could not create update directory: " + fullPath, new Win32Exception(error));
        }

        private static FileStream CreateOutputFile(string value)
        {
            string fullPath = IsAbsolutePath(value) ? value : Path.GetFullPath(value);
            SafeFileHandle handle = CreateFileW(ToExtendedPath(fullPath), GenericWrite, FileShareRead, IntPtr.Zero,
                CreateAlways, FileAttributeNormal, IntPtr.Zero);
            if (handle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new IOException("Could not write update file: " + fullPath, new Win32Exception(error));
            }
            return new FileStream(handle, FileAccess.Write, 128 * 1024, false);
        }

        private static string ParentDirectory(string value)
        {
            if (String.IsNullOrEmpty(value)) return null;
            string trimmed = value.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            int rootLength = RootLength(value);
            if (rootLength > 0 && trimmed.Length <= rootLength) return null;
            int slash = Math.Max(trimmed.LastIndexOf(Path.DirectorySeparatorChar), trimmed.LastIndexOf(Path.AltDirectorySeparatorChar));
            if (slash < 0) return null;
            if (rootLength > 0 && slash < rootLength) return value.Substring(0, rootLength);
            return trimmed.Substring(0, slash);
        }

        private static bool IsAbsolutePath(string value)
        {
            if (String.IsNullOrEmpty(value)) return false;
            if (value.StartsWith("\\\\", StringComparison.Ordinal)) return true;
            return value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':'
                && (value[2] == Path.DirectorySeparatorChar || value[2] == Path.AltDirectorySeparatorChar);
        }

        private static int RootLength(string value)
        {
            if (String.IsNullOrEmpty(value)) return 0;
            if (value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':'
                && (value[2] == Path.DirectorySeparatorChar || value[2] == Path.AltDirectorySeparatorChar)) return 3;
            if (!value.StartsWith("\\\\", StringComparison.Ordinal)) return 0;
            int serverEnd = value.IndexOfAny(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, 2);
            if (serverEnd < 0) return value.Length;
            int shareEnd = value.IndexOfAny(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, serverEnd + 1);
            return shareEnd < 0 ? value.Length : shareEnd + 1;
        }

        private static string ToExtendedPath(string value)
        {
            string fullPath = IsAbsolutePath(value) ? value : Path.GetFullPath(value);
            if (fullPath.StartsWith("\\\\?\\", StringComparison.Ordinal)) return fullPath;
            if (fullPath.StartsWith("\\\\", StringComparison.Ordinal)) return "\\\\?\\UNC\\" + fullPath.Substring(2);
            return "\\\\?\\" + fullPath;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateDirectoryW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateDirectoryW(string path, IntPtr securityAttributes);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "GetFileAttributesW")]
        private static extern uint GetFileAttributesW(string path);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
        private static extern SafeFileHandle CreateFileW(string filename, uint desiredAccess, uint shareMode,
            IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);
    }
}
