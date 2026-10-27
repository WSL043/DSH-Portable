import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execute = promisify(execFile)

test('native title layout and rendered icons fit effective DPI and enlarged text without cumulative scaling', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-title-dpi-'))
  const source = await readFile(new URL('../launcher/windows/DesktopChrome.cs', import.meta.url), 'utf8')
  const begin = source.indexOf('    internal sealed class DesktopTitleStrip : MenuStrip')
  const end = source.indexOf('    internal sealed class DesktopContentPanel', begin)
  assert.ok(begin > 0 && end > begin)
  const colorBegin = source.indexOf('    internal sealed class DshMenuColorTable')
  const colorEnd = source.indexOf('    internal sealed class DshMenuRenderer', colorBegin)
  const rendererBegin = source.indexOf('    internal sealed class DesktopTitleRenderer')
  const rendererEnd = source.indexOf('    internal sealed class DesktopDropDown', rendererBegin)
  assert.ok(colorBegin > 0 && colorEnd > colorBegin && rendererEnd > rendererBegin)
  const fixture = path.join(root, 'DpiProbe.cs')
  const executable = path.join(root, 'DpiProbe.exe')
  const result = path.join(root, 'result.txt')
  await writeFile(fixture, 'using System; using System.Drawing; using System.Drawing.Drawing2D; using System.IO; using System.Linq; using System.Windows.Forms; namespace DshPortable {\n'
    + source.slice(colorBegin, colorEnd) + source.slice(rendererBegin, rendererEnd) + source.slice(begin, end) + String.raw`
class Probe {
  static void Require(bool value, string reason) { if (!value) throw new Exception(reason); }
  static Size IconInk(DesktopTitleStrip strip, string name) {
    ToolStripItem item = strip.Items[name];
    using (var bitmap = new Bitmap(strip.Width, strip.Height)) {
      // DrawToBitmap uses a 96-DPI canvas even when the native layout represents another DPI.
      bitmap.SetResolution(96, 96);
      strip.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
      int left = item.Bounds.Right, top = item.Bounds.Bottom, right = item.Bounds.Left - 1, bottom = item.Bounds.Top - 1;
      for (int y = item.Bounds.Top; y < item.Bounds.Bottom; y++) for (int x = item.Bounds.Left; x < item.Bounds.Right; x++) {
        Color pixel = bitmap.GetPixel(x, y);
        if (Math.Abs(pixel.R - strip.BackColor.R) + Math.Abs(pixel.G - strip.BackColor.G) + Math.Abs(pixel.B - strip.BackColor.B) < 90) continue;
        left = Math.Min(left, x); top = Math.Min(top, y); right = Math.Max(right, x); bottom = Math.Max(bottom, y);
      }
      return new Size(Math.Max(0, right - left + 1), Math.Max(0, bottom - top + 1));
    }
  }
  [STAThread] static int Main(string[] args) {
    try {
      Application.EnableVisualStyles();
      int cases = 0;
      foreach (int dpi in new[] { 96, 120, 144, 192, 288 })
      foreach (string language in new[] { "zh", "en" })
      using (var window = new Form()) using (var strip = new DesktopTitleStrip())
      using (var font = new Font("Segoe UI", 10.5F * dpi / 96F)) {
        // Effective display/font metrics are simulated; do not change the user's displays.
        window.AutoScaleMode = AutoScaleMode.None;
        window.ClientSize = new Size(1600, 240);
        strip.Font = font; strip.AutoSize = false; strip.Dock = DockStyle.Top;
        strip.BackColor = Color.FromArgb(249, 250, 251); strip.Renderer = new DesktopTitleRenderer(false);
        window.Controls.Add(strip);
        strip.Items.Add(new ToolStripMenuItem(" ") { Name = "nav-sidebar" });
        strip.Items.Add(new ToolStripMenuItem(" ") { Name = "nav-new-session" });
        foreach (string title in (language == "zh" ? new[] { "文件", "视图", "帮助" } : new[] { "File", "View", "Help" }))
          strip.Items.Add(new ToolStripMenuItem(title) { Name = "menu-" + strip.Items.Count });
        strip.Items.Add(new ToolStripMenuItem("x") { Name = "caption-close", Alignment = ToolStripItemAlignment.Right });
        IntPtr handle = window.Handle; handle = strip.Handle;
        strip.ApplyLayout(dpi); window.PerformLayout(); strip.PerformLayout();
        int firstHeight = strip.Height;
        Size[] sizes = strip.Items.Cast<ToolStripItem>().Select(item => item.Size).ToArray();
        strip.ApplyLayout(192); strip.ApplyLayout(dpi);
        Require(strip.Height == firstHeight && !strip.Items.Cast<ToolStripItem>().Where((item, index) => item.Size != sizes[index]).Any(), "cumulative DPI scaling");
        foreach (ToolStripItem item in strip.Items) {
          Require(item.Bounds.Top >= 0 && item.Bounds.Bottom <= strip.Height, "item outside title strip");
          if (!item.Name.StartsWith("menu-")) continue;
          Size text;
          using (Graphics graphics = strip.CreateGraphics())
            text = TextRenderer.MeasureText(graphics, item.Text, font, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine);
          Require(item.Height >= text.Height + DesktopTitleStrip.ScalePixels(4, dpi), "clipped text height");
          Require(item.Width >= text.Width + DesktopTitleStrip.ScalePixels(10, dpi) * 2, "clipped text width");
        }
        Require(strip.Items[strip.Items.Count - 1].Height == strip.Height, "caption hit target too short");
        if (dpi == 96) Require(strip.Height == 40 && strip.Items[1].Height == 28, "100% layout changed");
        foreach (string name in new[] { "nav-sidebar", "nav-new-session" }) {
          Size ink = IconInk(strip, name);
          Require(ink.Width >= 12 * dpi / 96F && ink.Height >= 12 * dpi / 96F, "icon remained at unscaled canvas DPI");
          Require(ink.Width <= 16 * dpi / 96F + 2 && ink.Height <= 16 * dpi / 96F + 2, "icon exceeds its logical viewBox");
          File.AppendAllText(args[0] + ".metrics", dpi + ":" + language + ":" + name + ":" + ink.Width + "x" + ink.Height + Environment.NewLine);
        }
        cases++;
      }
      using (var strip = new DesktopTitleStrip()) using (var enlargedFont = new Font("Segoe UI", 30F)) {
        strip.BackColor = Color.FromArgb(249, 250, 251); strip.Renderer = new DesktopTitleRenderer(false);
        strip.Items.Add(new ToolStripMenuItem(" ") { Name = "nav-sidebar" });
        strip.Items.Add(new ToolStripMenuItem("文件Ag") { Name = "menu-file" });
        IntPtr handle = strip.Handle;
        strip.ApplyLayout(96); int originalHeight = strip.Height;
        strip.Font = enlargedFont;
        int textHeight;
        using (Graphics graphics = strip.CreateGraphics())
          textHeight = TextRenderer.MeasureText(graphics, "文件Ag", enlargedFont, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.SingleLine).Height;
        Require(strip.Height > originalHeight && strip.Items[1].Height >= textHeight, "font-only enlargement clipped");
        Size ink = IconInk(strip, "nav-sidebar");
        Require(ink.Width >= 12 * enlargedFont.SizeInPoints / 10.5F, "font-only enlargement left icon too small");
      }
      File.WriteAllText(args[0], "passed:" + cases); return 0;
    } catch (Exception error) { File.WriteAllText(args[0], error.ToString()); return 1; }
  }
}
}
`)
  await execute(path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
    '/nologo', '/target:winexe', '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', `/out:${executable}`, fixture,
  ], { windowsHide: true, timeout: 20000 })
  await execute(executable, [result], { windowsHide: true, timeout: 20000 })
  assert.equal(await readFile(result, 'utf8'), 'passed:10')
})
