using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace AIVideoWorkbenchUpdater
{
    internal static class Program
    {
        private static void Log(string path, string message)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.AppendAllText(
                    path,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine,
                    Encoding.UTF8
                );
            }
            catch
            {
            }
        }

        private static int Main(string[] args)
        {
            if (args.Length < 3) return 2;
            var source = Path.GetFullPath(args[0]);
            var target = Path.GetFullPath(args[1]);
            var log = Path.GetFullPath(args[2]);
            var relaunch = args.Length >= 4 && String.Equals(args[3], "--relaunch", StringComparison.OrdinalIgnoreCase);

            using (var mutex = new Mutex(false, "FandaoAIVideoWorkbenchLauncherUpdater"))
            {
                try
                {
                    if (!mutex.WaitOne(0, false)) return 0;
                }
                catch (AbandonedMutexException)
                {
                }

                Log(log, "启动器更新等待开始");
                if (!File.Exists(source))
                {
                    Log(log, "未找到新版启动器：" + source);
                    return 3;
                }

                for (var attempt = 1; attempt <= 600; attempt += 1)
                {
                    try
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        var temporary = target + ".new";
                        File.Copy(source, temporary, true);
                        File.Copy(temporary, target, true);
                        File.Delete(temporary);
                        Log(log, "启动器已更新：" + target);
                        if (relaunch)
                        {
                            var restartMarker = Path.Combine(Path.GetDirectoryName(target), "updates", "restart-required.json");
                            try { if (File.Exists(restartMarker)) File.Delete(restartMarker); } catch { }
                            Thread.Sleep(700);
                            Process.Start(new ProcessStartInfo {
                                FileName = target,
                                UseShellExecute = true,
                                WorkingDirectory = Path.GetDirectoryName(target)
                            });
                            Log(log, "新版启动器已自动重新启动");
                        }
                        return 0;
                    }
                    catch (IOException)
                    {
                        if (attempt == 1) Log(log, "启动器正在运行，关闭工作台后将自动完成替换");
                    }
                    catch (UnauthorizedAccessException)
                    {
                        if (attempt == 1) Log(log, "启动器文件暂被占用，关闭工作台后将自动完成替换");
                    }
                    catch (Exception error)
                    {
                        Log(log, "启动器更新失败：" + error.Message);
                        return 4;
                    }
                    Thread.Sleep(2000);
                }

                Log(log, "等待启动器关闭超时，将在下次启动时再次尝试");
                return 5;
            }
        }
    }
}
