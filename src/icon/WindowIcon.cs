using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class SurfWindowIcon {
  public delegate bool EnumCallback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadImage(IntPtr instance, string file, uint type, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr param, IntPtr value, uint flags, uint timeout, out IntPtr result);

  static bool Owns(IntPtr window, int processId) {
    uint pid;
    GetWindowThreadProcessId(window, out pid);
    var name = new StringBuilder(256);
    GetClassName(window, name, name.Capacity);
    return pid == processId && name.ToString() == "Chrome_WidgetWin_1";
  }

  public static List<IntPtr> Windows(int processId) {
    var windows = new List<IntPtr>();
    EnumWindows((window, _) => {
      if (IsWindowVisible(window) && Owns(window, processId)) windows.Add(window);
      return true;
    }, IntPtr.Zero);
    return windows;
  }

  static bool Message(IntPtr window, uint message, int kind, IntPtr icon, out IntPtr result) {
    return SendMessageTimeout(window, message, (IntPtr)kind, icon, 2, 250, out result) != IntPtr.Zero;
  }

  // Surf owns a dedicated browser process. Never guess by title, focus, or URL.
  public static void Run(int processId, string iconFile, string stopFile) {
    using var process = Process.GetProcessById(processId);
    IntPtr window = IntPtr.Zero;
    var timer = Stopwatch.StartNew();
    while (!process.HasExited && !File.Exists(stopFile) && timer.Elapsed < TimeSpan.FromSeconds(30)) {
      var matches = Windows(processId);
      if (matches.Count > 1) throw new InvalidOperationException("Multiple browser windows; refusing to guess which icon to change.");
      if (matches.Count == 1) { window = matches[0]; break; }
      Thread.Sleep(100);
    }
    if (window == IntPtr.Zero) {
      if (!process.HasExited && !File.Exists(stopFile)) throw new TimeoutException("No app window found.");
      return;
    }
    SetThreadDpiAwarenessContext((IntPtr)(-4));
    var icons = new Dictionary<int, IntPtr>();
    try {
      while (!process.HasExited && IsWindow(window) && Owns(window, processId) && !File.Exists(stopFile)) {
        uint dpi = GetDpiForWindow(window);
        if (dpi == 0) dpi = 96;
        for (int kind = 0; kind <= 1; kind++) {
          int size = (int)Math.Round((kind == 1 ? 32 : 16) * dpi / 96.0);
          if (!icons.TryGetValue(size, out IntPtr icon)) {
            icon = LoadImage(IntPtr.Zero, iconFile, 1, size, size, 0x10);
            if (icon == IntPtr.Zero) throw new InvalidOperationException("LoadImage failed for " + iconFile);
            icons.Add(size, icon);
          }
          IntPtr current;
          if (Message(window, 0x7F, kind, IntPtr.Zero, out current) && current != icon) {
            IntPtr previous;
            Message(window, 0x80, kind, icon, out previous);
            // Previous handles belong to Chromium, never destroy them.
          }
        }
        Thread.Sleep(500);
      }
    } finally {
      if (!process.HasExited && IsWindow(window) && Owns(window, processId)) {
        for (int kind = 0; kind <= 1; kind++) {
          IntPtr current, ignored;
          if (Message(window, 0x7F, kind, IntPtr.Zero, out current) && icons.ContainsValue(current)) {
            Message(window, 0x80, kind, IntPtr.Zero, out ignored);
          }
        }
      }
      foreach (var icon in icons.Values) DestroyIcon(icon);
    }
  }
}
