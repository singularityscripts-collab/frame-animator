// Compila o desinstalador (sem payload) e tira fotos das telas do instalador e do desinstalador.
// Uso: node scripts/installer-shots.cjs <pasta>  (o modo --shots não instala nem apaga nada)
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const FW = path.join(process.env.WINDIR || 'C:\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const WPF = ['PresentationCore.dll', 'PresentationFramework.dll', 'WindowsBase.dll'].map((d) => '-r:' + path.join(FW, 'WPF', d));
const r = (p) => path.resolve(__dirname, '..', p);
const run = (c, a) => {
  const x = spawnSync(c, a, { stdio: 'inherit' });
  if (x.error) throw x.error;
  if (x.status) process.exit(x.status);
};
const out = path.resolve(process.argv[2] || 'shots');
fs.writeFileSync(r('dist/installer/Version.cs'), `static class BuildInfo { public const string Version = "${require(r('package.json')).version}"; }\n`);
run(path.join(FW, 'csc.exe'), ['-nologo', '-target:winexe', '-out:' + r('dist/installer/shots.exe'), '-win32icon:' + r('build/icon.ico'), '-win32manifest:' + r('installer/app.manifest'), ...WPF, '-r:System.Xaml.dll', '-r:System.IO.Compression.dll', '-r:System.IO.Compression.FileSystem.dll', '-r:System.Windows.Forms.dll', r('installer/Setup.cs'), r('dist/installer/Version.cs')]);
run(r('dist/installer/shots.exe'), ['--from-temp', r('dist/installer'), '--shots', path.join(out, 'desinstalar')]);
