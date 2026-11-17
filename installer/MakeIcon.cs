// Gera o ícone do Frame Animator (build/icon.ico e build/icon.png) desenhando com WPF.
// Desenho: quadrado arredondado em degradê azul→violeta com uma bola e dois "fantasmas" dela
// (onion skin), lembrando o exercício clássico da bola quicando.
// Uso: MakeIcon.exe <pasta de saída>
using System;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

static class MakeIcon
{
    static BitmapSource Render(int size)
    {
        var dv = new DrawingVisual();
        double s = size;
        using (var dc = dv.RenderOpen())
        {
            var bg = new LinearGradientBrush(Color.FromRgb(0x4F, 0x9D, 0xFF), Color.FromRgb(0x7B, 0x5C, 0xFF), new Point(0, 0), new Point(1, 1));
            double r = s * 0.22, pad = s * 0.04;
            dc.DrawRoundedRectangle(bg, null, new Rect(pad, pad, s - pad * 2, s - pad * 2), r, r);
            // brilho suave em cima
            var gloss = new LinearGradientBrush(Color.FromArgb(60, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), new Point(0.5, 0), new Point(0.5, 0.6));
            dc.DrawRoundedRectangle(gloss, null, new Rect(pad, pad, s - pad * 2, s - pad * 2), r, r);
            // chão
            var floor = new Pen(new SolidColorBrush(Color.FromArgb(150, 255, 255, 255)), Math.Max(1, s * 0.035));
            floor.StartLineCap = PenLineCap.Round;
            floor.EndLineCap = PenLineCap.Round;
            dc.DrawLine(floor, new Point(s * 0.2, s * 0.76), new Point(s * 0.8, s * 0.76));
            // fantasmas (onion skin) e a bola achatada no chão
            double br = s * 0.13;
            dc.DrawEllipse(new SolidColorBrush(Color.FromArgb(70, 255, 255, 255)), null, new Point(s * 0.30, s * 0.30), br * 0.92, br * 0.92);
            dc.DrawEllipse(new SolidColorBrush(Color.FromArgb(130, 255, 255, 255)), null, new Point(s * 0.44, s * 0.48), br * 0.96, br * 0.96);
            dc.DrawEllipse(Brushes.White, null, new Point(s * 0.60, s * 0.76 - br * 0.82), br * 1.18, br * 0.82);
        }
        var bmp = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        bmp.Render(dv);
        return bmp;
    }

    static byte[] Png(BitmapSource b)
    {
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(b));
        using (var ms = new MemoryStream())
        {
            enc.Save(ms);
            return ms.ToArray();
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        string dir = args.Length > 0 ? args[0] : ".";
        Directory.CreateDirectory(dir);
        int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };
        var pngs = new byte[sizes.Length][];
        for (int i = 0; i < sizes.Length; i++) pngs[i] = Png(Render(sizes[i]));
        File.WriteAllBytes(Path.Combine(dir, "icon.png"), Png(Render(512)));
        // ICO com as imagens em PNG (aceito pelo Windows Vista em diante)
        using (var fs = File.Create(Path.Combine(dir, "icon.ico")))
        using (var w = new BinaryWriter(fs))
        {
            w.Write((short)0);
            w.Write((short)1);
            w.Write((short)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++)
            {
                w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                w.Write((byte)0);
                w.Write((byte)0);
                w.Write((short)1);
                w.Write((short)32);
                w.Write(pngs[i].Length);
                w.Write(offset);
                offset += pngs[i].Length;
            }
            foreach (var p in pngs) w.Write(p);
        }
        Console.WriteLine("ok");
        return 0;
    }
}
