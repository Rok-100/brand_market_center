using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("AI视频工作台")]
[assembly: AssemblyDescription("凡岛AI视频工作台无窗口启动器")]
[assembly: AssemblyCompany("凡岛AI项目组")]
[assembly: AssemblyProduct("AI视频工作台")]
[assembly: AssemblyVersion("2.4.1.0")]
[assembly: AssemblyFileVersion("2.4.1.0")]

namespace AIVideoWorkbenchLauncher
{
    internal sealed class LauncherContext : ApplicationContext
    {
        private const string WorkbenchUrl = "http://127.0.0.1:3766/";
        private readonly string root;
        private readonly string appDir;
        private readonly string nodePath;
        private readonly string serverPath;
        private readonly string outputDir;
        private readonly string logDir;
        private readonly string serverLogPath;
        private readonly string launcherLogPath;
        private readonly string restartMarkerPath;
        private readonly NotifyIcon trayIcon;
        private readonly System.Windows.Forms.Timer probeTimer;
        private Process serverProcess;
        private DateTime startAttemptAt;
        private bool ready;
        private bool exiting;
        private bool workbenchOpened;
        private bool autoOpenPending = true;
        private bool startupFailureReported;

        internal LauncherContext()
        {
            root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            appDir = Path.Combine(root, "app");
            nodePath = Path.Combine(root, "runtime", "node.exe");
            serverPath = Path.Combine(appDir, "server.js");
            outputDir = Path.Combine(appDir, "outputs");
            logDir = Path.Combine(root, "logs");
            serverLogPath = Path.Combine(logDir, "server-v2.4.1.log");
            launcherLogPath = Path.Combine(logDir, "launcher-v2.4.1.log");
            restartMarkerPath = Path.Combine(root, "updates", "restart-required.json");

            var menu = new ContextMenuStrip();
            menu.Items.Add("打开工作台", null, delegate { OpenTarget(WorkbenchUrl); });
            menu.Items.Add("输出文件夹", null, delegate {
                Directory.CreateDirectory(outputDir);
                OpenTarget(outputDir);
            });
            menu.Items.Add("在网页绑定LibTV", null, delegate { StartLibTvLogin(); });
            menu.Items.Add("修复并重启", null, delegate { RestartServer(); });
            menu.Items.Add("启动日志", null, delegate {
                Directory.CreateDirectory(logDir);
                if (!File.Exists(serverLogPath)) File.WriteAllText(serverLogPath, "", Encoding.UTF8);
                OpenTarget(serverLogPath);
            });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出工作台服务", null, delegate { ExitWorkbench(); });

            trayIcon = new NotifyIcon {
                Icon = SystemIcons.Application,
                Text = "AI视频工作台 · 正在启动",
                ContextMenuStrip = menu,
                Visible = true
            };
            trayIcon.DoubleClick += delegate { OpenTarget(WorkbenchUrl); };

            probeTimer = new System.Windows.Forms.Timer { Interval = 1200 };
            probeTimer.Tick += delegate { ProbeService(); };
            BeginStartup(false);
        }

        private void BeginStartup(bool forceStart)
        {
            ready = false;
            autoOpenPending = true;
            startupFailureReported = false;
            if (forceStart) workbenchOpened = false;
            startAttemptAt = DateTime.Now;
            trayIcon.Text = "AI视频工作台 · 正在启动";
            AppendLauncherLog("正在检查本地服务");

            if (forceStart || !IsServiceReady())
            {
                StartServerProcess();
            }
            probeTimer.Start();
            ProbeService();
        }

        private void StartServerProcess()
        {
            try
            {
                Directory.CreateDirectory(logDir);
                if (!File.Exists(nodePath)) throw new FileNotFoundException("缺少内置运行时", nodePath);
                if (!File.Exists(serverPath)) throw new FileNotFoundException("缺少工作台服务文件", serverPath);
                AppendLauncherLog("准备启动本地服务");

                var info = new ProcessStartInfo {
                    FileName = nodePath,
                    Arguments = "\"" + serverPath + "\"",
                    WorkingDirectory = appDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                };
                serverProcess = new Process { StartInfo = info, EnableRaisingEvents = true };
                serverProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data != null) AppendServerLog("[OUT] " + e.Data);
                };
                serverProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                    if (e.Data != null) AppendServerLog("[ERR] " + e.Data);
                };
                serverProcess.Exited += delegate {
                    if (exiting) return;
                    AppendLauncherLog("本地服务进程已退出");
                };
                serverProcess.Start();
                serverProcess.BeginOutputReadLine();
                serverProcess.BeginErrorReadLine();
            }
            catch (Exception error)
            {
                AppendLauncherLog("启动失败：" + error);
                ShowFailure("本地服务无法启动", error.Message + "。请右键任务栏托盘图标，打开“启动日志”。");
            }
        }

        private void ProbeService()
        {
            if (exiting) return;
            if (File.Exists(restartMarkerPath))
            {
                RestartAfterUpdate();
                return;
            }

            if (IsServiceReady())
            {
                if (!ready) AppendLauncherLog("本地服务已就绪");
                ready = true;
                trayIcon.Text = "AI视频工作台 · 已就绪";
                if (autoOpenPending && !workbenchOpened)
                {
                    autoOpenPending = false;
                    workbenchOpened = true;
                    OpenTarget(WorkbenchUrl);
                }
                return;
            }

            ready = false;
            trayIcon.Text = "AI视频工作台 · 服务启动中";
            var elapsed = DateTime.Now - startAttemptAt;
            if (elapsed.TotalSeconds >= 90)
            {
                if (!startupFailureReported)
                {
                    startupFailureReported = true;
                    ShowFailure("本地服务启动未完成", "已等待90秒仍未连接。请右键任务栏托盘图标选择“修复并重启”，并可打开“启动日志”查看原因。");
                }
                return;
            }

            if (serverProcess != null && serverProcess.HasExited)
            {
                if (!startupFailureReported)
                {
                    startupFailureReported = true;
                    ShowFailure("本地服务提前退出", "请右键任务栏托盘图标选择“修复并重启”，并可打开“启动日志”查看原因。");
                }
            }
        }

        private bool IsServiceReady()
        {
            return ProbeUrl(WorkbenchUrl + "api/ready")
                || ProbeUrl(WorkbenchUrl + "api/app-meta")
                || ProbeUrl(WorkbenchUrl + "api/defaults");
        }

        private static bool ProbeUrl(string url)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 1500;
                request.ReadWriteTimeout = 1500;
                request.Proxy = null;
                request.KeepAlive = false;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private void RestartServer()
        {
            probeTimer.Stop();
            ready = false;
            StopOwnedServer();
            Thread.Sleep(300);
            BeginStartup(true);
        }

        private void RestartAfterUpdate()
        {
            try { File.Delete(restartMarkerPath); } catch { }
            AppendLauncherLog("检测到在线更新完成，正在无窗口重启服务");
            probeTimer.Stop();
            StopOwnedServer();
            exiting = true;
            trayIcon.Visible = false;
            ExitThread();
        }

        private void StartLibTvLogin()
        {
            trayIcon.Text = "AI视频工作台 · 请在网页绑定LibTV";
            OpenTarget(WorkbenchUrl);
        }

        private void OpenTarget(string target)
        {
            try
            {
                Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
            }
            catch (Exception error)
            {
                ShowFailure("无法打开", error.Message);
            }
        }

        private void ShowFailure(string title, string detail)
        {
            ready = false;
            trayIcon.Text = "AI视频工作台 · 需要处理";
            AppendLauncherLog(title + "：" + detail);
            trayIcon.BalloonTipTitle = title;
            trayIcon.BalloonTipText = detail;
            trayIcon.BalloonTipIcon = ToolTipIcon.Warning;
            trayIcon.ShowBalloonTip(7000);
        }

        private void StopOwnedServer()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                    serverProcess.WaitForExit(5000);
                }
            }
            catch (Exception error)
            {
                AppendLauncherLog("停止旧服务时出现提示：" + error.Message);
            }
        }

        private void ExitWorkbench()
        {
            exiting = true;
            probeTimer.Stop();
            StopOwnedServer();
            trayIcon.Visible = false;
            ExitThread();
        }

        private void AppendServerLog(string line)
        {
            AppendText(serverLogPath, line);
        }

        private void AppendLauncherLog(string line)
        {
            AppendText(launcherLogPath, line);
        }

        private static readonly object LogLock = new object();

        private static void AppendText(string path, string line)
        {
            try
            {
                lock (LogLock)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch
            {
            }
        }

        protected override void ExitThreadCore()
        {
            trayIcon.Visible = false;
            trayIcon.Dispose();
            probeTimer.Dispose();
            base.ExitThreadCore();
        }
    }

    internal static class Program
    {
        private const string WorkbenchUrl = "http://127.0.0.1:3766/";

        private static void OpenExistingWorkbench()
        {
            try
            {
                Process.Start(new ProcessStartInfo { FileName = WorkbenchUrl, UseShellExecute = true });
            }
            catch
            {
            }
        }

        [STAThread]
        private static void Main()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            bool createdNew;
            using (var mutex = new Mutex(true, "FandaoAIVideoWorkbenchLauncher", out createdNew))
            {
                if (!createdNew)
                {
                    OpenExistingWorkbench();
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new LauncherContext());
            }
        }
    }
}
