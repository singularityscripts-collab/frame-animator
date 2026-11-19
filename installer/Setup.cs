// Instalador e desinstalador do Frame Animator (C# 5 / WPF, compilado pelo csc do Windows).
// - Com o recurso "payload.zip" embutido: instalador (ou atualizador, com --update).
// - Sem ele: desinstalador (fica na pasta do app como "Desinstalar Frame Animator.exe").
// Instala só para o usuário atual (sem pedir administrador), em %LOCALAPPDATA%\Programs.
//
// Argumentos:
//   --update --dir <pasta> --pid <id>  atualização: espera o app fechar, troca os arquivos e abre de novo
//   --silent                           sem janela (desinstalar ou instalar direto)
//   --from-temp <pasta>                (interno) desinstalador rodando de uma cópia na pasta temporária
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using Microsoft.Win32;

class InstallError : Exception
{
    public InstallError(string msg) : base(msg) { }
}

static class Paths
{
    public const string AppName = "Frame Animator";
    public const string ExeName = "Frame Animator.exe";
    public const string UninstName = "Desinstalar Frame Animator.exe";
    public const string RegKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameAnimator";

    public static string DefaultDir
    {
        get { return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName); }
    }
    public static string StartMenuLink
    {
        get { return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk"); }
    }
    public static string DesktopLink
    {
        get { return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"); }
    }
    public static string UserData
    {
        get { return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppName); }
    }
    /** Pasta registrada da instalação anterior (ou null). */
    public static string Registered()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(RegKey))
        {
            if (k == null) return null;
            var v = k.GetValue("InstallLocation") as string;
            return string.IsNullOrEmpty(v) ? null : v;
        }
    }
}

class Options
{
    public bool Update, Silent;
    public string Dir, FromTemp, Shots;
    public int Pid;

    public static Options Parse(string[] args)
    {
        var o = new Options();
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            string next = i + 1 < args.Length ? args[i + 1] : null;
            if (a == "--update") o.Update = true;
            else if (a == "--silent" || a == "/S") o.Silent = true;
            else if (a == "--dir" && next != null) { o.Dir = next; i++; }
            else if (a == "--from-temp" && next != null) { o.FromTemp = next; i++; }
            else if (a == "--pid" && next != null) { int.TryParse(next, out o.Pid); i++; }
            else if (a == "--shots" && next != null) { o.Shots = next; i++; }
        }
        return o;
    }
}

// ---------------------------------------------------------------------------------------------
// Trabalho de verdade (sem interface): instalar e desinstalar.
// ---------------------------------------------------------------------------------------------
static class Engine
{
    public delegate void Progress(double fraction, string status, string detail);

    static bool HasExe(string dir) { return File.Exists(System.IO.Path.Combine(dir, Paths.ExeName)); }

    /** Pasta onde instalar: nunca apaga uma pasta com outras coisas (usa uma subpasta). */
    public static string SafeTarget(string chosen)
    {
        string dir = System.IO.Path.GetFullPath(chosen.Trim().TrimEnd('\\'));
        if (!Directory.Exists(dir) || HasExe(dir)) return dir;
        if (Directory.GetFileSystemEntries(dir).Length == 0) return dir;
        return System.IO.Path.Combine(dir, Paths.AppName);
    }

    static bool RunningFrom(string dir)
    {
        foreach (var p in Process.GetProcessesByName(System.IO.Path.GetFileNameWithoutExtension(Paths.ExeName)))
        {
            try
            {
                if (p.MainModule.FileName.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) return true;
            }
            catch { return true; }
        }
        return false;
    }

    static void WaitForPid(int pid, Progress report)
    {
        if (pid <= 0) return;
        Process p = null;
        try { p = Process.GetProcessById(pid); } catch { return; }
        report(0, "Esperando o Frame Animator fechar…", "");
        if (!p.WaitForExit(60000)) throw new InstallError("O Frame Animator não fechou. Feche o app (salve antes, se precisar) e clique em Tentar de novo.");
        Thread.Sleep(400);
    }

    /** Depois do processo principal, os processos auxiliares do app (GPU, renderização) ainda levam um instante para fechar. */
    static void WaitForHelpers(string dir, Progress report)
    {
        for (int i = 0; i < 50 && RunningFrom(dir); i++)
        {
            if (i == 3) report(0, "Esperando o Frame Animator fechar…", "");
            Thread.Sleep(400);
        }
    }

    /** Tira a versão antiga instalada pelo instalador anterior (0.1.x), se houver. */
    static void RemoveLegacy(Progress report)
    {
        using (var root = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
        {
            if (root == null) return;
            foreach (string name in root.GetSubKeyNames())
            {
                if (name == "FrameAnimator") continue;
                using (var k = root.OpenSubKey(name))
                {
                    var dn = k == null ? null : k.GetValue("DisplayName") as string;
                    if (dn == null || !dn.StartsWith(Paths.AppName)) continue;
                    string cmd = (k.GetValue("QuietUninstallString") as string) ?? ((k.GetValue("UninstallString") as string) + " /S");
                    if (string.IsNullOrEmpty(cmd)) continue;
                    report(0.02, "Removendo a versão antiga…", "");
                    string exe, rest;
                    SplitCommand(cmd, out exe, out rest);
                    if (!File.Exists(exe)) continue;
                    try
                    {
                        var p = Process.Start(new ProcessStartInfo(exe, rest) { UseShellExecute = false, CreateNoWindow = true });
                        p.WaitForExit(120000);
                    }
                    catch { }
                    // o desinstalador antigo continua sozinho por uns segundos: espera a chave sumir
                    for (int i = 0; i < 60 && Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + name) != null; i++) Thread.Sleep(500);
                }
            }
        }
    }

    static void SplitCommand(string cmd, out string exe, out string rest)
    {
        cmd = cmd.Trim();
        if (cmd.StartsWith("\""))
        {
            int e = cmd.IndexOf('"', 1);
            exe = cmd.Substring(1, e - 1);
            rest = cmd.Substring(e + 1).Trim();
        }
        else
        {
            int e = cmd.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
            exe = e > 0 ? cmd.Substring(0, e + 4) : cmd;
            rest = e > 0 ? cmd.Substring(e + 4).Trim() : "";
        }
    }

    static void TryDelete(string dir)
    {
        for (int i = 0; i < 10; i++)
        {
            try
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                return;
            }
            catch { Thread.Sleep(300); }
        }
    }

    static void Retry(Action a, string failMsg, int tries = 12)
    {
        Exception last = null;
        for (int i = 0; i < tries; i++)
        {
            try { a(); return; }
            catch (Exception e) { last = e; Thread.Sleep(400); }
        }
        throw new InstallError(failMsg + (last != null ? " (" + last.Message + ")" : ""));
    }

    public static long PayloadSize()
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
        {
            long total = 0;
            foreach (var e in zip.Entries) total += e.Length;
            return total;
        }
    }

    public static string Install(string target, bool desktop, Options o, Progress report)
    {
        string dir = o.Update && o.Dir != null ? System.IO.Path.GetFullPath(o.Dir) : SafeTarget(target);
        if (o.Update)
        {
            WaitForPid(o.Pid, report);
            WaitForHelpers(dir, report);
        }
        else if (RunningFrom(dir)) throw new InstallError("O Frame Animator está aberto. Feche o app e clique em Tentar de novo.");
        if (!o.Update) RemoveLegacy(report);

        var asm = Assembly.GetExecutingAssembly();
        string tmp = dir + ".instalando";
        TryDelete(tmp);
        Directory.CreateDirectory(tmp);
        string root = System.IO.Path.GetFullPath(tmp) + "\\";
        try
        {
            using (var s = asm.GetManifestResourceStream("payload.zip"))
            using (var zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                long total = 0, done = 0;
                foreach (var e in zip.Entries) total += e.Length;
                var drive = new DriveInfo(System.IO.Path.GetPathRoot(root));
                if (drive.AvailableFreeSpace < total + 50L * 1024 * 1024)
                    throw new InstallError(string.Format("Falta espaço no disco {0}: o Frame Animator precisa de {1} MB livres. Libere espaço e tente de novo.", drive.Name, (total + 50L * 1024 * 1024) / 1048576));
                byte[] buf = new byte[1 << 16];
                foreach (var e in zip.Entries)
                {
                    string dest = System.IO.Path.GetFullPath(System.IO.Path.Combine(tmp, e.FullName));
                    if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue; // caminho fora da pasta: ignora
                    if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\")) { Directory.CreateDirectory(dest); continue; }
                    Directory.CreateDirectory(System.IO.Path.GetDirectoryName(dest));
                    using (var src = e.Open())
                    using (var dst = File.Create(dest))
                    {
                        int n;
                        while ((n = src.Read(buf, 0, buf.Length)) > 0)
                        {
                            dst.Write(buf, 0, n);
                            done += n;
                        }
                    }
                    report(0.05 + 0.85 * (total > 0 ? (double)done / total : 1), "Copiando os arquivos…", e.Name);
                }
            }
            using (var u = asm.GetManifestResourceStream("uninstall.exe"))
            using (var f = File.Create(System.IO.Path.Combine(tmp, Paths.UninstName)))
                u.CopyTo(f);
        }
        catch
        {
            TryDelete(tmp);
            throw;
        }

        // troca a pasta inteira de uma vez (com volta atrás se algo der errado)
        report(0.92, "Finalizando…", "");
        string old = null;
        if (Directory.Exists(dir))
        {
            old = dir + ".antigo-" + DateTime.Now.Ticks;
            try { Retry(delegate { Directory.Move(dir, old); }, "Não deu para trocar os arquivos: algum arquivo do Frame Animator está em uso. Feche o app e tente de novo.", 30); }
            catch
            {
                TryDelete(tmp); // não deixa a cópia nova sobrando ao lado da pasta do app
                throw;
            }
        }
        try { Retry(delegate { Directory.Move(tmp, dir); }, "Não deu para mover os arquivos novos para a pasta de instalação."); }
        catch
        {
            if (old != null) try { Directory.Move(old, dir); } catch { }
            TryDelete(tmp);
            throw;
        }
        if (old != null) TryDelete(old);

        string exe = System.IO.Path.Combine(dir, Paths.ExeName);
        report(0.96, "Criando atalhos…", "");
        Shortcut(Paths.StartMenuLink, exe, dir);
        if (desktop || (o.Update && File.Exists(Paths.DesktopLink))) Shortcut(Paths.DesktopLink, exe, dir);
        Register(dir, exe);
        report(1, "Pronto", "");
        return exe;
    }

    static void Register(string dir, string exe)
    {
        long kb = 0;
        try { foreach (var f in new DirectoryInfo(dir).GetFiles("*", SearchOption.AllDirectories)) kb += f.Length / 1024; } catch { }
        using (var k = Registry.CurrentUser.CreateSubKey(Paths.RegKey))
        {
            string un = System.IO.Path.Combine(dir, Paths.UninstName);
            k.SetValue("DisplayName", Paths.AppName);
            k.SetValue("DisplayVersion", BuildInfo.Version);
            k.SetValue("Publisher", Paths.AppName);
            k.SetValue("DisplayIcon", exe + ",0");
            k.SetValue("InstallLocation", dir);
            k.SetValue("UninstallString", "\"" + un + "\"");
            k.SetValue("QuietUninstallString", "\"" + un + "\" --silent");
            k.SetValue("URLInfoAbout", "https://github.com/singularityscripts-collab/frame-animator");
            k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, kb), RegistryValueKind.DWord);
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }

    static void Shortcut(string lnk, string target, string workDir)
    {
        try
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object sh = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
            Type st = sc.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
            st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Editor de animação 2D" });
            st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
            Marshal.FinalReleaseComObject(sc);
            Marshal.FinalReleaseComObject(sh);
        }
        catch { }
    }

    static bool LinkPointsInto(string lnk, string dir)
    {
        if (!File.Exists(lnk)) return false;
        try
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object sh = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
            string target = (string)sc.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, sc, null);
            Marshal.FinalReleaseComObject(sc);
            Marshal.FinalReleaseComObject(sh);
            return target != null && target.StartsWith(dir, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static void Uninstall(string dir, bool wipeData, Progress report)
    {
        if (string.IsNullOrEmpty(dir) || !HasExe(dir)) throw new InstallError("Não achei a instalação do Frame Animator nesta pasta.");
        if (RunningFrom(dir)) throw new InstallError("O Frame Animator está aberto. Feche o app e clique em Tentar de novo.");
        report(0.2, "Removendo atalhos…", "");
        foreach (var l in new[] { Paths.StartMenuLink, Paths.DesktopLink })
            if (LinkPointsInto(l, dir)) try { File.Delete(l); } catch { }
        report(0.4, "Removendo os arquivos…", "");
        Retry(delegate { if (Directory.Exists(dir)) Directory.Delete(dir, true); }, "Não deu para apagar a pasta do app: algum arquivo está em uso. Feche o Frame Animator e tente de novo.");
        try { Registry.CurrentUser.DeleteSubKeyTree(Paths.RegKey, false); } catch { }
        if (wipeData)
        {
            report(0.85, "Apagando as configurações…", "");
            TryDelete(Paths.UserData);
        }
        report(1, "Pronto", "");
    }
}

// ---------------------------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------------------------
class SetupWindow : Window
{
    const string Xaml = @"
<Grid xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'>
  <Grid.Resources>
    <Style x:Key='Primary' TargetType='Button'>
      <Setter Property='Foreground' Value='White'/>
      <Setter Property='FontSize' Value='14'/>
      <Setter Property='FontWeight' Value='SemiBold'/>
      <Setter Property='Cursor' Value='Hand'/>
      <Setter Property='Height' Value='42'/>
      <Setter Property='Padding' Value='26,0'/>
      <Setter Property='RenderTransformOrigin' Value='0.5,0.5'/>
      <Setter Property='RenderTransform'><Setter.Value><ScaleTransform/></Setter.Value></Setter>
      <Setter Property='Template'>
        <Setter.Value>
          <ControlTemplate TargetType='Button'>
            <Grid>
              <Border x:Name='Bd' CornerRadius='11' Background='{TemplateBinding Background}'/>
              <Border x:Name='Hover' CornerRadius='11' Background='#30FFFFFF' Opacity='0'/>
              <ContentPresenter HorizontalAlignment='Center' VerticalAlignment='Center' Margin='{TemplateBinding Padding}'/>
            </Grid>
            <ControlTemplate.Triggers>
              <EventTrigger RoutedEvent='MouseEnter'><BeginStoryboard><Storyboard><DoubleAnimation Storyboard.TargetName='Hover' Storyboard.TargetProperty='Opacity' To='1' Duration='0:0:0.15'/></Storyboard></BeginStoryboard></EventTrigger>
              <EventTrigger RoutedEvent='MouseLeave'><BeginStoryboard><Storyboard><DoubleAnimation Storyboard.TargetName='Hover' Storyboard.TargetProperty='Opacity' To='0' Duration='0:0:0.25'/></Storyboard></BeginStoryboard></EventTrigger>
              <EventTrigger RoutedEvent='PreviewMouseLeftButtonDown'><BeginStoryboard><Storyboard>
                <DoubleAnimation Storyboard.TargetProperty='RenderTransform.ScaleX' To='0.96' Duration='0:0:0.08'/>
                <DoubleAnimation Storyboard.TargetProperty='RenderTransform.ScaleY' To='0.96' Duration='0:0:0.08'/></Storyboard></BeginStoryboard></EventTrigger>
              <EventTrigger RoutedEvent='PreviewMouseLeftButtonUp'><BeginStoryboard><Storyboard>
                <DoubleAnimation Storyboard.TargetProperty='RenderTransform.ScaleX' To='1' Duration='0:0:0.18'><DoubleAnimation.EasingFunction><BackEase EasingMode='EaseOut'/></DoubleAnimation.EasingFunction></DoubleAnimation>
                <DoubleAnimation Storyboard.TargetProperty='RenderTransform.ScaleY' To='1' Duration='0:0:0.18'><DoubleAnimation.EasingFunction><BackEase EasingMode='EaseOut'/></DoubleAnimation.EasingFunction></DoubleAnimation></Storyboard></BeginStoryboard></EventTrigger>
              <Trigger Property='IsEnabled' Value='False'><Setter Property='Opacity' Value='0.45'/></Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
      <Setter Property='Background'>
        <Setter.Value><LinearGradientBrush StartPoint='0,0' EndPoint='1,1'><GradientStop Color='#4F9DFF' Offset='0'/><GradientStop Color='#7B5CFF' Offset='1'/></LinearGradientBrush></Setter.Value>
      </Setter>
    </Style>
    <Style x:Key='Ghost' TargetType='Button' BasedOn='{StaticResource Primary}'>
      <Setter Property='Background' Value='#14FFFFFF'/>
      <Setter Property='Foreground' Value='#E6E6EA'/>
      <Setter Property='FontWeight' Value='Normal'/>
    </Style>
    <Style x:Key='Link' TargetType='Button'>
      <Setter Property='Foreground' Value='#8FBFFF'/>
      <Setter Property='Cursor' Value='Hand'/>
      <Setter Property='FontSize' Value='13'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='Button'>
        <TextBlock x:Name='T' Text='{Binding Content, RelativeSource={RelativeSource TemplatedParent}}' Foreground='{TemplateBinding Foreground}'/>
        <ControlTemplate.Triggers><Trigger Property='IsMouseOver' Value='True'><Setter TargetName='T' Property='TextDecorations' Value='Underline'/></Trigger></ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
    <Style TargetType='CheckBox'>
      <Setter Property='Foreground' Value='#C8C8D0'/>
      <Setter Property='FontSize' Value='13'/>
      <Setter Property='Cursor' Value='Hand'/>
      <Setter Property='Template'><Setter.Value><ControlTemplate TargetType='CheckBox'>
        <StackPanel Orientation='Horizontal' Background='Transparent'>
          <Border x:Name='Box' Width='20' Height='20' CornerRadius='6' BorderThickness='1.5' BorderBrush='#5A5A66' Background='#1AFFFFFF'>
            <Path x:Name='Mark' Data='M4.5,10 L8.5,14 L15.5,6' Stroke='White' StrokeThickness='2.2' StrokeStartLineCap='Round' StrokeEndLineCap='Round' StrokeLineJoin='Round' Opacity='0'/>
          </Border>
          <ContentPresenter Margin='10,0,0,0' VerticalAlignment='Center'/>
        </StackPanel>
        <ControlTemplate.Triggers>
          <Trigger Property='IsChecked' Value='True'>
            <Setter TargetName='Box' Property='Background' Value='#4F9DFF'/>
            <Setter TargetName='Box' Property='BorderBrush' Value='#4F9DFF'/>
            <Setter TargetName='Mark' Property='Opacity' Value='1'/>
          </Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
  </Grid.Resources>

  <Border x:Name='Card' Margin='24' CornerRadius='18' ClipToBounds='True'>
    <Border.Background>
      <LinearGradientBrush StartPoint='0,0' EndPoint='0,1'><GradientStop Color='#25252C' Offset='0'/><GradientStop Color='#1A1A1F' Offset='1'/></LinearGradientBrush>
    </Border.Background>
    <Border.Effect><DropShadowEffect BlurRadius='28' ShadowDepth='6' Opacity='0.55' Color='Black'/></Border.Effect>
    <Grid>
      <!-- manchas de luz que flutuam devagar no fundo -->
      <Canvas IsHitTestVisible='False' ClipToBounds='True'>
        <Ellipse x:Name='BlobA' Width='340' Height='340' Canvas.Left='-120' Canvas.Top='-170' Opacity='0.55'>
          <Ellipse.Fill><RadialGradientBrush><GradientStop Color='#554F9DFF' Offset='0'/><GradientStop Color='#004F9DFF' Offset='1'/></RadialGradientBrush></Ellipse.Fill>
          <Ellipse.RenderTransform><TranslateTransform/></Ellipse.RenderTransform>
        </Ellipse>
        <Ellipse x:Name='BlobB' Width='380' Height='380' Canvas.Left='260' Canvas.Top='-120' Opacity='0.5'>
          <Ellipse.Fill><RadialGradientBrush><GradientStop Color='#557B5CFF' Offset='0'/><GradientStop Color='#007B5CFF' Offset='1'/></RadialGradientBrush></Ellipse.Fill>
          <Ellipse.RenderTransform><TranslateTransform/></Ellipse.RenderTransform>
        </Ellipse>
      </Canvas>
      <Border BorderBrush='#22FFFFFF' BorderThickness='1' CornerRadius='18' IsHitTestVisible='False'/>

      <Grid Margin='34,22,34,22'>
        <Grid.RowDefinitions>
          <RowDefinition Height='Auto'/>
          <RowDefinition Height='*'/>
          <RowDefinition Height='Auto'/>
        </Grid.RowDefinitions>

        <!-- cabeçalho: a bola quicando, com o onion skin -->
        <Grid Grid.Row='0'>
          <Grid.ColumnDefinitions><ColumnDefinition Width='Auto'/><ColumnDefinition Width='*'/></Grid.ColumnDefinitions>
          <Canvas Width='112' Height='92' Margin='0,0,18,0'>
            <Rectangle Canvas.Left='6' Canvas.Top='82' Width='100' Height='3' RadiusX='1.5' RadiusY='1.5' Fill='#33FFFFFF'/>
            <Ellipse x:Name='Shadow' Canvas.Left='56' Canvas.Top='80' Width='34' Height='7' Fill='#55000000' RenderTransformOrigin='0.5,0.5'><Ellipse.RenderTransform><ScaleTransform/></Ellipse.RenderTransform></Ellipse>
            <Ellipse x:Name='Ghost2' Canvas.Left='18' Canvas.Top='48' Width='34' Height='34' Fill='#7B5CFF' Opacity='0.22' RenderTransformOrigin='0.5,1'><Ellipse.RenderTransform><TransformGroup><ScaleTransform/><TranslateTransform/></TransformGroup></Ellipse.RenderTransform></Ellipse>
            <Ellipse x:Name='Ghost1' Canvas.Left='37' Canvas.Top='48' Width='34' Height='34' Fill='#6C7BFF' Opacity='0.42' RenderTransformOrigin='0.5,1'><Ellipse.RenderTransform><TransformGroup><ScaleTransform/><TranslateTransform/></TransformGroup></Ellipse.RenderTransform></Ellipse>
            <Ellipse x:Name='Ball' Canvas.Left='56' Canvas.Top='48' Width='34' Height='34' RenderTransformOrigin='0.5,1'>
              <Ellipse.Fill><RadialGradientBrush GradientOrigin='0.35,0.3'><GradientStop Color='#FFFFFF' Offset='0'/><GradientStop Color='#8FC2FF' Offset='0.45'/><GradientStop Color='#4F9DFF' Offset='1'/></RadialGradientBrush></Ellipse.Fill>
              <Ellipse.RenderTransform><TransformGroup><ScaleTransform/><TranslateTransform/></TransformGroup></Ellipse.RenderTransform>
            </Ellipse>
          </Canvas>
          <StackPanel Grid.Column='1' VerticalAlignment='Center'>
            <TextBlock Text='Frame Animator' FontSize='30' FontWeight='Bold' FontFamily='Segoe UI Variable Display, Segoe UI'>
              <TextBlock.Foreground><LinearGradientBrush StartPoint='0,0' EndPoint='1,0'><GradientStop Color='#FFFFFF' Offset='0'/><GradientStop Color='#B9C8FF' Offset='1'/></LinearGradientBrush></TextBlock.Foreground>
            </TextBlock>
            <TextBlock x:Name='Sub' Text='Editor de animação 2D' Foreground='#9A9AA6' FontSize='13.5' Margin='2,2,0,0'/>
          </StackPanel>
        </Grid>

        <!-- páginas -->
        <Grid Grid.Row='1' Margin='0,18,0,0'>
          <StackPanel x:Name='PageWelcome' VerticalAlignment='Center'>
            <TextBlock x:Name='WelcomeTitle' Text='Pronto para instalar' Foreground='White' FontSize='19' FontWeight='SemiBold'/>
            <TextBlock x:Name='WelcomeText' Text='O Frame Animator vai ser instalado em:' Foreground='#A8A8B4' FontSize='13' Margin='0,6,0,8' TextWrapping='Wrap'/>
            <Border CornerRadius='10' Background='#14FFFFFF' BorderBrush='#26FFFFFF' BorderThickness='1' Padding='12,9'>
              <DockPanel>
                <Button x:Name='ChangeDir' DockPanel.Dock='Right' Style='{StaticResource Link}' Content='Alterar…' Margin='12,0,0,0' VerticalAlignment='Center'/>
                <TextBlock x:Name='DirText' Foreground='#E6E6EA' FontSize='13' TextTrimming='CharacterEllipsis' VerticalAlignment='Center'/>
              </DockPanel>
            </Border>
            <CheckBox x:Name='Option' Content='Criar atalho na área de trabalho' IsChecked='True' Margin='2,14,0,0'/>
            <TextBlock x:Name='Note' Text='Instala só para você, sem pedir permissão de administrador.' Foreground='#6E6E7A' FontSize='12' Margin='2,10,0,0'/>
          </StackPanel>

          <StackPanel x:Name='PageProgress' VerticalAlignment='Center' Visibility='Collapsed'>
            <DockPanel>
              <TextBlock x:Name='Percent' DockPanel.Dock='Right' Text='0%' Foreground='White' FontSize='26' FontWeight='Bold' FontFamily='Segoe UI Variable Display, Segoe UI'/>
              <StackPanel VerticalAlignment='Bottom'>
                <TextBlock x:Name='Status' Text='Preparando…' Foreground='White' FontSize='17' FontWeight='SemiBold'/>
                <TextBlock x:Name='Detail' Text=' ' Foreground='#8A8A96' FontSize='12' Margin='0,3,0,0' TextTrimming='CharacterEllipsis'/>
              </StackPanel>
            </DockPanel>
            <Border x:Name='Track' Height='10' CornerRadius='5' Background='#1FFFFFFF' Margin='0,14,0,0' ClipToBounds='True'>
              <Border x:Name='Fill' HorizontalAlignment='Left' Width='0' CornerRadius='5' ClipToBounds='True'>
                <Border.Background><LinearGradientBrush StartPoint='0,0' EndPoint='1,0'><GradientStop Color='#4F9DFF' Offset='0'/><GradientStop Color='#7B5CFF' Offset='1'/></LinearGradientBrush></Border.Background>
                <Rectangle x:Name='Shine' Width='90' HorizontalAlignment='Left'>
                  <Rectangle.Fill><LinearGradientBrush StartPoint='0,0' EndPoint='1,0'><GradientStop Color='#00FFFFFF' Offset='0'/><GradientStop Color='#66FFFFFF' Offset='0.5'/><GradientStop Color='#00FFFFFF' Offset='1'/></LinearGradientBrush></Rectangle.Fill>
                  <Rectangle.RenderTransform><TranslateTransform/></Rectangle.RenderTransform>
                </Rectangle>
              </Border>
            </Border>
          </StackPanel>

          <StackPanel x:Name='PageDone' Orientation='Horizontal' VerticalAlignment='Center' Visibility='Collapsed'>
            <Grid Width='64' Height='64' Margin='0,0,18,0'>
              <Ellipse x:Name='DoneCircle' RenderTransformOrigin='0.5,0.5'>
                <Ellipse.Fill><LinearGradientBrush StartPoint='0,0' EndPoint='1,1'><GradientStop Color='#30D158' Offset='0'/><GradientStop Color='#1FA346' Offset='1'/></LinearGradientBrush></Ellipse.Fill>
                <Ellipse.RenderTransform><ScaleTransform/></Ellipse.RenderTransform>
              </Ellipse>
              <Path x:Name='DoneMark' Data='M19,33 L28,42 L46,23' Stroke='White' StrokeThickness='5' StrokeStartLineCap='Round' StrokeEndLineCap='Round' StrokeLineJoin='Round' StrokeDashArray='12 12' StrokeDashOffset='12'/>
            </Grid>
            <StackPanel VerticalAlignment='Center'>
              <TextBlock x:Name='DoneTitle' Text='Tudo pronto!' Foreground='White' FontSize='22' FontWeight='SemiBold'/>
              <TextBlock x:Name='DoneText' Text='O Frame Animator foi instalado.' Foreground='#A8A8B4' FontSize='13' Margin='0,4,0,0' TextWrapping='Wrap' MaxWidth='330'/>
            </StackPanel>
          </StackPanel>

          <StackPanel x:Name='PageError' Orientation='Horizontal' VerticalAlignment='Center' Visibility='Collapsed'>
            <Grid Width='56' Height='56' Margin='0,0,18,0' VerticalAlignment='Top'>
              <Ellipse Fill='#33FF5D5D' Stroke='#FF5D5D' StrokeThickness='2'/>
              <TextBlock Text='!' Foreground='#FF7B7B' FontSize='28' FontWeight='Bold' HorizontalAlignment='Center' VerticalAlignment='Center'/>
            </Grid>
            <StackPanel VerticalAlignment='Center'>
              <TextBlock Text='Algo deu errado' Foreground='White' FontSize='19' FontWeight='SemiBold'/>
              <TextBlock x:Name='ErrorText' Foreground='#C8C8D0' FontSize='13' Margin='0,5,0,0' TextWrapping='Wrap' MaxWidth='360'/>
            </StackPanel>
          </StackPanel>
        </Grid>

        <!-- rodapé -->
        <DockPanel Grid.Row='2' Margin='0,16,0,0' LastChildFill='False'>
          <TextBlock x:Name='Foot' DockPanel.Dock='Left' VerticalAlignment='Center' Foreground='#6E6E7A' FontSize='12'/>
          <Button x:Name='PrimaryBtn' DockPanel.Dock='Right' Style='{StaticResource Primary}' Content='Instalar'/>
          <Button x:Name='SecondaryBtn' DockPanel.Dock='Right' Style='{StaticResource Ghost}' Content='Cancelar' Margin='0,0,10,0'/>
        </DockPanel>
      </Grid>

      <Button x:Name='CloseBtn' HorizontalAlignment='Right' VerticalAlignment='Top' Margin='0,12,12,0' Width='30' Height='30' Cursor='Hand' ToolTip='Fechar'>
        <Button.Template><ControlTemplate TargetType='Button'>
          <Border x:Name='B' CornerRadius='8' Background='Transparent'>
            <Path Data='M10,10 L20,20 M20,10 L10,20' Stroke='#9A9AA6' StrokeThickness='1.8' StrokeStartLineCap='Round' StrokeEndLineCap='Round'/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property='IsMouseOver' Value='True'><Setter TargetName='B' Property='Background' Value='#1FFFFFFF'/></Trigger>
            <Trigger Property='IsEnabled' Value='False'><Setter Property='Opacity' Value='0.3'/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate></Button.Template>
      </Button>
    </Grid>
  </Border>
</Grid>";

    readonly Grid root;
    readonly Options opt;
    readonly bool uninstall;
    string dir;
    string installedExe;
    FrameworkElement current;
    double shown;
    enum Stage { Welcome, Working, Done, Error }
    Stage stage = Stage.Welcome;

    T Find<T>(string name) where T : class { return root.FindName(name) as T; }

    public SetupWindow(Options o, bool isUninstall)
    {
        opt = o;
        uninstall = isUninstall;
        Title = uninstall ? "Desinstalar o Frame Animator" : "Instalar o Frame Animator";
        Width = 600;
        Height = 420;
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI");
        root = (Grid)XamlReader.Parse(Xaml);
        Content = root;
        TextOptions.SetTextFormattingMode(root, TextFormattingMode.Display);

        current = Find<FrameworkElement>("PageWelcome");
        Find<Border>("Card").MouseLeftButtonDown += delegate (object s, MouseButtonEventArgs e) { if (e.ButtonState == MouseButtonState.Pressed) try { DragMove(); } catch { } };
        Find<Button>("CloseBtn").Click += delegate { if (stage != Stage.Working) Close(); };
        Find<Button>("SecondaryBtn").Click += delegate { OnSecondary(); };
        Find<Button>("PrimaryBtn").Click += delegate { OnPrimary(); };
        Find<Button>("ChangeDir").Click += delegate { PickDir(); };
        Find<TextBlock>("Foot").Text = "Versão " + BuildInfo.Version;

        if (uninstall)
        {
            dir = o.FromTemp ?? Paths.Registered() ?? System.IO.Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            Find<TextBlock>("Sub").Text = "Desinstalação";
            Find<TextBlock>("WelcomeTitle").Text = "Desinstalar o Frame Animator?";
            Find<TextBlock>("WelcomeText").Text = "O app e os atalhos vão ser removidos desta pasta. Suas animações (.fanim) não são apagadas.";
            Find<Button>("ChangeDir").Visibility = Visibility.Collapsed;
            Find<TextBlock>("Note").Visibility = Visibility.Collapsed;
            var chk = Find<CheckBox>("Option");
            chk.Content = "Apagar também as configurações (atalhos, presets, layout)";
            chk.IsChecked = false;
            var p = Find<Button>("PrimaryBtn");
            p.Content = "Desinstalar";
            p.Background = new LinearGradientBrush(Color.FromRgb(0xFF, 0x5D, 0x5D), Color.FromRgb(0xD9, 0x3A, 0x5A), 45);
        }
        else
        {
            dir = Paths.Registered() ?? Paths.DefaultDir;
            if (o.Update)
            {
                Find<TextBlock>("Sub").Text = "Atualizando para a versão " + BuildInfo.Version;
                // atualização vai direto para o progresso (sem tela de boas-vindas)
                Find<FrameworkElement>("PageWelcome").Visibility = Visibility.Collapsed;
                current = Find<FrameworkElement>("PageProgress");
                current.Visibility = Visibility.Visible;
                Find<Button>("PrimaryBtn").Visibility = Visibility.Collapsed;
                Find<Button>("SecondaryBtn").Visibility = Visibility.Collapsed;
            }
            else
            {
                Find<TextBlock>("Sub").Text = "Versão " + BuildInfo.Version;
                try
                {
                    long mb = Engine.PayloadSize() / 1048576;
                    Find<TextBlock>("WelcomeText").Text = "O Frame Animator vai ser instalado em (ocupa " + mb + " MB):";
                }
                catch { }
            }
        }
        Find<TextBlock>("DirText").Text = dir;
        Find<TextBlock>("DirText").ToolTip = dir;

        Loaded += delegate
        {
            Intro();
            StartBounce();
            StartBlobs();
            if (opt.Shots != null) { Shots(); return; }
            if (opt.Update) Run();
        };
    }

    // ---------- fotos da janela (só para conferir o visual: --shots <pasta>; não instala nada) ----------
    void Snap(string name)
    {
        var bmp = new RenderTargetBitmap((int)ActualWidth, (int)ActualHeight, 96, 96, PixelFormats.Pbgra32);
        bmp.Render(root);
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(bmp));
        Directory.CreateDirectory(opt.Shots);
        using (var f = File.Create(System.IO.Path.Combine(opt.Shots, name + ".png"))) enc.Save(f);
    }

    void Shots()
    {
        var steps = new List<Action>();
        steps.Add(delegate { Snap("1-inicio"); stage = Stage.Working; Find<Button>("PrimaryBtn").Visibility = Visibility.Collapsed; Find<Button>("SecondaryBtn").Visibility = Visibility.Collapsed; ShowPage("PageProgress"); StartShine(); SetProgress(0.1, "Copiando os arquivos…", "resources.pak"); });
        steps.Add(delegate { SetProgress(0.62, "Copiando os arquivos…", "Frame Animator.exe"); });
        steps.Add(delegate { Snap("2-progresso"); Finish(null, null); });
        steps.Add(delegate { Snap("3-pronto"); Finish(new InstallError("O Frame Animator está aberto. Feche o app e clique em Tentar de novo."), null); });
        steps.Add(delegate { Snap("4-erro"); Close(); });
        int i = 0;
        var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(900) };
        t.Tick += delegate { if (i < steps.Count) steps[i++](); else t.Stop(); };
        t.Start();
    }

    // ---------- animações ----------
    static DoubleAnimation Anim(double to, double ms, IEasingFunction ease)
    {
        var a = new DoubleAnimation(to, TimeSpan.FromMilliseconds(ms));
        a.EasingFunction = ease;
        return a;
    }
    static EasingDoubleKeyFrame Key(double v, double ms, IEasingFunction e)
    {
        return new EasingDoubleKeyFrame(v, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(ms)), e);
    }

    void Intro()
    {
        var card = Find<Border>("Card");
        card.Opacity = 0;
        var st = new ScaleTransform(0.94, 0.94);
        card.RenderTransformOrigin = new Point(0.5, 0.5);
        card.RenderTransform = st;
        var back = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.35 };
        card.BeginAnimation(OpacityProperty, Anim(1, 260, new CubicEase { EasingMode = EasingMode.EaseOut }));
        st.BeginAnimation(ScaleTransform.ScaleXProperty, Anim(1, 420, back));
        st.BeginAnimation(ScaleTransform.ScaleYProperty, Anim(1, 420, back));
    }

    /** A bola quicando (com amassar e esticar) e dois fantasmas atrasados, como o onion skin. */
    void StartBounce()
    {
        var ballNames = new[] { "Ball", "Ghost1", "Ghost2" };
        for (int i = 0; i < ballNames.Length; i++)
        {
            var el = Find<Ellipse>(ballNames[i]);
            var g = (TransformGroup)el.RenderTransform;
            var sc = (ScaleTransform)g.Children[0];
            var tr = (TranslateTransform)g.Children[1];
            var begin = TimeSpan.FromMilliseconds(-i * 110);
            var fall = new QuadraticEase { EasingMode = EasingMode.EaseIn };
            var rise = new QuadraticEase { EasingMode = EasingMode.EaseOut };
            var y = new DoubleAnimationUsingKeyFrames { RepeatBehavior = RepeatBehavior.Forever, BeginTime = begin };
            y.KeyFrames.Add(Key(-46, 0, null));
            y.KeyFrames.Add(Key(0, 420, fall));
            y.KeyFrames.Add(Key(0, 480, null));
            y.KeyFrames.Add(Key(-46, 900, rise));
            var sx = new DoubleAnimationUsingKeyFrames { RepeatBehavior = RepeatBehavior.Forever, BeginTime = begin };
            sx.KeyFrames.Add(Key(0.92, 0, null));
            sx.KeyFrames.Add(Key(0.86, 380, null));
            sx.KeyFrames.Add(Key(1.28, 450, new SineEase()));
            sx.KeyFrames.Add(Key(0.88, 560, new SineEase()));
            sx.KeyFrames.Add(Key(0.92, 900, null));
            var sy = new DoubleAnimationUsingKeyFrames { RepeatBehavior = RepeatBehavior.Forever, BeginTime = begin };
            sy.KeyFrames.Add(Key(1.06, 0, null));
            sy.KeyFrames.Add(Key(1.14, 380, null));
            sy.KeyFrames.Add(Key(0.72, 450, new SineEase()));
            sy.KeyFrames.Add(Key(1.12, 560, new SineEase()));
            sy.KeyFrames.Add(Key(1.06, 900, null));
            tr.BeginAnimation(TranslateTransform.YProperty, y);
            sc.BeginAnimation(ScaleTransform.ScaleXProperty, sx);
            sc.BeginAnimation(ScaleTransform.ScaleYProperty, sy);
        }
        // sombra cresce quando a bola chega perto do chão
        var sh = (ScaleTransform)Find<Ellipse>("Shadow").RenderTransform;
        var s = new DoubleAnimationUsingKeyFrames { RepeatBehavior = RepeatBehavior.Forever };
        s.KeyFrames.Add(Key(0.45, 0, null));
        s.KeyFrames.Add(Key(1.1, 420, new QuadraticEase { EasingMode = EasingMode.EaseIn }));
        s.KeyFrames.Add(Key(1.1, 480, null));
        s.KeyFrames.Add(Key(0.45, 900, new QuadraticEase { EasingMode = EasingMode.EaseOut }));
        sh.BeginAnimation(ScaleTransform.ScaleXProperty, s);
    }

    void StartBlobs()
    {
        var names = new[] { "BlobA", "BlobB" };
        for (int i = 0; i < names.Length; i++)
        {
            var t = (TranslateTransform)Find<Ellipse>(names[i]).RenderTransform;
            var ease = new SineEase { EasingMode = EasingMode.EaseInOut };
            var x = new DoubleAnimation(i == 0 ? 60 : -70, TimeSpan.FromSeconds(7 + i * 2)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = ease };
            var y = new DoubleAnimation(i == 0 ? 40 : 50, TimeSpan.FromSeconds(9 - i * 2)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = ease };
            t.BeginAnimation(TranslateTransform.XProperty, x);
            t.BeginAnimation(TranslateTransform.YProperty, y);
        }
    }

    /** Troca de página: a atual sai para a esquerda, a nova entra pela direita. */
    void ShowPage(string name)
    {
        var next = Find<FrameworkElement>(name);
        if (next == current) return;
        var prev = current;
        current = next;
        var outT = new TranslateTransform();
        prev.RenderTransform = outT;
        var fadeOut = Anim(0, 160, new CubicEase { EasingMode = EasingMode.EaseIn });
        fadeOut.Completed += delegate
        {
            prev.Visibility = Visibility.Collapsed;
            var inT = new TranslateTransform(36, 0);
            next.RenderTransform = inT;
            next.Opacity = 0;
            next.Visibility = Visibility.Visible;
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            next.BeginAnimation(OpacityProperty, Anim(1, 320, ease));
            inT.BeginAnimation(TranslateTransform.XProperty, Anim(0, 380, ease));
            if (name == "PageDone") PlayCheck();
        };
        prev.BeginAnimation(OpacityProperty, fadeOut);
        outT.BeginAnimation(TranslateTransform.XProperty, Anim(-30, 160, new CubicEase { EasingMode = EasingMode.EaseIn }));
    }

    void PlayCheck()
    {
        var c = (ScaleTransform)Find<Ellipse>("DoneCircle").RenderTransform;
        c.ScaleX = c.ScaleY = 0.4;
        var back = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.6 };
        c.BeginAnimation(ScaleTransform.ScaleXProperty, Anim(1, 420, back));
        c.BeginAnimation(ScaleTransform.ScaleYProperty, Anim(1, 420, back));
        var mark = Find<System.Windows.Shapes.Path>("DoneMark");
        var draw = Anim(0, 420, new CubicEase { EasingMode = EasingMode.EaseOut });
        draw.BeginTime = TimeSpan.FromMilliseconds(220);
        mark.BeginAnimation(Shape.StrokeDashOffsetProperty, draw);
    }

    void StartShine()
    {
        var t = (TranslateTransform)Find<Rectangle>("Shine").RenderTransform;
        var a = new DoubleAnimation(-90, 520, TimeSpan.FromMilliseconds(1300)) { RepeatBehavior = RepeatBehavior.Forever };
        t.BeginAnimation(TranslateTransform.XProperty, a);
    }

    void SetProgress(double f, string status, string detail)
    {
        f = Math.Max(0, Math.Min(1, f));
        if (f < shown) f = shown;
        shown = f;
        var track = Find<Border>("Track");
        var fill = Find<Border>("Fill");
        var a = Anim(track.ActualWidth * f, 260, new CubicEase { EasingMode = EasingMode.EaseOut });
        fill.BeginAnimation(WidthProperty, a, HandoffBehavior.SnapshotAndReplace);
        Find<TextBlock>("Percent").Text = Math.Round(f * 100) + "%";
        if (status != null) Find<TextBlock>("Status").Text = status;
        Find<TextBlock>("Detail").Text = string.IsNullOrEmpty(detail) ? " " : detail;
    }

    // ---------- ações ----------
    void PickDir()
    {
        using (var d = new System.Windows.Forms.FolderBrowserDialog())
        {
            d.Description = "Escolha a pasta onde instalar o Frame Animator";
            d.SelectedPath = System.IO.Path.GetDirectoryName(dir);
            if (d.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
            dir = Engine.SafeTarget(d.SelectedPath);
            Find<TextBlock>("DirText").Text = dir;
            Find<TextBlock>("DirText").ToolTip = dir;
        }
    }

    void OnSecondary()
    {
        if (stage == Stage.Working) return;
        Close();
    }

    void OnPrimary()
    {
        if (stage == Stage.Welcome || stage == Stage.Error) { Run(); return; }
        if (stage == Stage.Done)
        {
            if (!uninstall && installedExe != null) Launch(installedExe);
            Close();
        }
    }

    static void Launch(string exe)
    {
        try { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = System.IO.Path.GetDirectoryName(exe) }); } catch { }
    }

    void Run()
    {
        stage = Stage.Working;
        shown = 0;
        Find<Button>("CloseBtn").IsEnabled = false;
        Find<Button>("PrimaryBtn").Visibility = Visibility.Collapsed;
        Find<Button>("SecondaryBtn").Visibility = Visibility.Collapsed;
        ShowPage("PageProgress");
        StartShine();
        Dispatcher.BeginInvoke(new Action(delegate { SetProgress(0, uninstall ? "Desinstalando…" : opt.Update ? "Atualizando…" : "Instalando…", ""); }));
        bool option = Find<CheckBox>("Option").IsChecked == true;
        string target = dir;
        var th = new Thread(delegate ()
        {
            Exception err = null;
            string exe = null;
            Engine.Progress report = delegate (double f, string s, string d)
            {
                Dispatcher.BeginInvoke(new Action(delegate { SetProgress(f, s, d); }));
            };
            try
            {
                if (uninstall) Engine.Uninstall(target, option, report);
                else exe = Engine.Install(target, option, opt, report);
            }
            catch (Exception e) { err = e; }
            Dispatcher.BeginInvoke(new Action(delegate { Finish(err, exe); }));
        });
        th.IsBackground = true;
        th.Start();
    }

    void Finish(Exception err, string exe)
    {
        Find<Button>("CloseBtn").IsEnabled = true;
        var primary = Find<Button>("PrimaryBtn");
        var secondary = Find<Button>("SecondaryBtn");
        primary.Visibility = Visibility.Visible;
        secondary.Visibility = Visibility.Visible;
        if (err != null)
        {
            stage = Stage.Error;
            Find<TextBlock>("ErrorText").Text = err is InstallError ? err.Message : "Erro inesperado: " + err.Message;
            primary.Content = "Tentar de novo";
            secondary.Content = "Fechar";
            ShowPage("PageError");
            return;
        }
        stage = Stage.Done;
        installedExe = exe;
        if (uninstall)
        {
            Find<TextBlock>("DoneTitle").Text = "Desinstalado";
            Find<TextBlock>("DoneText").Text = "O Frame Animator foi removido. Obrigado por usar!";
            primary.Content = "Fechar";
            secondary.Visibility = Visibility.Collapsed;
            Engine_SelfDelete();
        }
        else if (opt.Update)
        {
            Find<TextBlock>("DoneTitle").Text = "Atualizado!";
            Find<TextBlock>("DoneText").Text = "Abrindo o Frame Animator " + BuildInfo.Version + "…";
            primary.Visibility = Visibility.Collapsed;
            secondary.Visibility = Visibility.Collapsed;
            var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1300) };
            t.Tick += delegate { t.Stop(); Launch(exe); Close(); };
            t.Start();
        }
        else
        {
            primary.Content = "Abrir o Frame Animator";
            secondary.Content = "Fechar";
        }
        ShowPage("PageDone");
    }

    void Engine_SelfDelete() { }
}

static class App
{
    /** Apaga esta cópia temporária do desinstalador depois que ela fechar. */
    public static void ScheduleSelfDelete()
    {
        try
        {
            string me = Assembly.GetExecutingAssembly().Location;
            // só a cópia temporária se apaga (nunca o desinstalador da pasta do app)
            if (!me.StartsWith(System.IO.Path.GetTempPath(), StringComparison.OrdinalIgnoreCase)) return;
            Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 > nul & del /f /q \"" + me + "\"") { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        }
        catch { }
    }

    [STAThread]
    static int Main(string[] args)
    {
        var o = Options.Parse(args);
        // Quem abre o instalador passa a pasta atual dele (o app abre o atualizador com a pasta atual
        // dentro da pasta de instalação). No Windows, um processo com a pasta atual numa pasta impede
        // que ela seja renomeada ou apagada: sai dela antes de tudo.
        try { Environment.CurrentDirectory = System.IO.Path.GetTempPath(); } catch { }
        bool hasPayload = Assembly.GetExecutingAssembly().GetManifestResourceInfo("payload.zip") != null;
        bool uninstall = !hasPayload;

        if (uninstall && o.FromTemp == null)
        {
            // o desinstalador não consegue apagar a própria pasta enquanto roda de dentro dela:
            // copia para a pasta temporária e roda de lá
            string me = Assembly.GetExecutingAssembly().Location;
            string dir = System.IO.Path.GetDirectoryName(me);
            string tmp = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "fa-desinstalar-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            try
            {
                File.Copy(me, tmp, true);
                var list = new List<string> { "--from-temp", "\"" + dir + "\"" };
                if (o.Silent) list.Add("--silent");
                Process.Start(new ProcessStartInfo(tmp, string.Join(" ", list.ToArray())) { UseShellExecute = false, WorkingDirectory = System.IO.Path.GetTempPath() });
                return 0;
            }
            catch
            {
                o.FromTemp = dir; // segue daqui mesmo (a pasta pode sobrar)
            }
        }

        if (o.Silent)
        {
            try
            {
                Engine.Progress none = delegate { };
                if (uninstall) { Engine.Uninstall(o.FromTemp, false, none); ScheduleSelfDelete(); }
                else Engine.Install(Paths.Registered() ?? Paths.DefaultDir, true, o, none);
                return 0;
            }
            catch { return 1; }
        }

        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var w = new SetupWindow(o, uninstall);
        int code = app.Run(w);
        if (uninstall) ScheduleSelfDelete();
        return code;
    }
}
