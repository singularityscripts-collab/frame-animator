// Gera o instalador do Frame Animator (npm run dist).
// 1. ícone (build/icon.ico), se ainda não existir;
// 2. app empacotado pelo electron-builder (dist/win-unpacked);
// 3. payload.zip com o app;
// 4. desinstalador e instalador (C#/WPF, compilados pelo csc que já vem no Windows),
//    com o payload e o desinstalador embutidos;
// 5. SHA256SUMS.txt (a atualização automática confere o download com ele).
// Opções: --skip-app (reaproveita dist/win-unpacked), --icon (refaz o ícone).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const out = path.join(root, 'dist');
const work = path.join(out, 'installer');
const FW = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const CSC = path.join(FW, 'csc.exe');
const WPF = ['PresentationCore.dll', 'PresentationFramework.dll', 'WindowsBase.dll'].map((d) => `-r:${path.join(FW, 'WPF', d)}`);
const args = new Set(process.argv.slice(2));

const step = (msg) => console.log(`\n› ${msg}`);
function run(cmd, list, opts = {}) {
  const r = spawnSync(cmd, list, { stdio: 'inherit', cwd: root, ...opts });
  if (r.status !== 0) throw new Error(`falhou: ${path.basename(cmd)} ${list.join(' ')}`);
}
function csc(outFile, sources, extra = []) {
  run(CSC, ['-nologo', '-optimize+', '-platform:anycpu', `-out:${outFile}`, ...WPF, '-r:System.Xaml.dll', '-r:System.IO.Compression.dll', '-r:System.IO.Compression.FileSystem.dll', '-r:System.Windows.Forms.dll', ...extra, ...sources]);
}

if (!fs.existsSync(CSC)) throw new Error('Não achei o compilador C# do .NET Framework 4 (csc.exe). Ele vem com o Windows 10/11.');
fs.mkdirSync(work, { recursive: true });

const icon = path.join(root, 'build', 'icon.ico');
if (!fs.existsSync(icon) || args.has('--icon')) {
  step('Ícone');
  csc(path.join(work, 'MakeIcon.exe'), [path.join(root, 'installer', 'MakeIcon.cs')], ['-target:exe']);
  run(path.join(work, 'MakeIcon.exe'), [path.join(root, 'build')]);
}

const appDir = path.join(out, 'win-unpacked');
if (!args.has('--skip-app')) {
  step('App (electron-builder)');
  run(process.execPath, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), '--win', '--dir']);
}
if (!fs.existsSync(path.join(appDir, 'Frame Animator.exe'))) throw new Error('dist/win-unpacked não tem o app. Rode sem --skip-app.');

step('Compactando o app');
const payload = path.join(work, 'payload.zip');
fs.rmSync(payload, { force: true });
run('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${appDir.replace(/'/g, "''")}', '${payload.replace(/'/g, "''")}', [IO.Compression.CompressionLevel]::Optimal, $false)`,
]);
console.log(`  ${(fs.statSync(payload).size / 1048576).toFixed(1)} MB`);

const src = path.join(root, 'installer', 'Setup.cs');
const common = ['-target:winexe', `-win32icon:${icon}`, `-win32manifest:${path.join(root, 'installer', 'app.manifest')}`, `-define:VERSION_${version.replace(/\./g, '_')}`];
fs.writeFileSync(path.join(work, 'Version.cs'), `static class BuildInfo { public const string Version = "${version}"; }\n`);

step('Desinstalador');
const uninst = path.join(work, 'uninstall.exe');
csc(uninst, [src, path.join(work, 'Version.cs')], common);

step('Instalador');
const setupName = `Frame-Animator-Setup-${version}.exe`;
const setup = path.join(out, setupName);
csc(setup, [src, path.join(work, 'Version.cs')], [...common, `-resource:${payload},payload.zip`, `-resource:${uninst},uninstall.exe`]);

step('Soma de verificação');
const hash = crypto.createHash('sha256').update(fs.readFileSync(setup)).digest('hex');
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), `${hash}  ${setupName}\n`);
console.log(`  ${setupName}: ${(fs.statSync(setup).size / 1048576).toFixed(1)} MB\n  sha256 ${hash}`);
