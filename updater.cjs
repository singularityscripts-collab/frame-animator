// Atualização automática pelo GitHub Releases.
// - check(): consulta a última release pública do repositório e diz se há versão mais nova.
// - download(): baixa o instalador da release (com progresso) e confere o SHA-256 com o
//   SHA256SUMS.txt publicado junto (ou o digest que o GitHub informa). Sem conferência, não instala.
// - install(): abre o instalador em modo atualização (ele espera o app fechar, troca os arquivos
//   e abre o app de novo) e fecha o app.
// Não manda nada do usuário para o GitHub: só pede a lista da release, com um User-Agent genérico.

const { app, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const REPO = require('./package.json').updateRepo || 'singularityscripts-collab/frame-animator';
const UA = 'Frame-Animator-Updater';
const ASSET = /^Frame-Animator-Setup-(\d+\.\d+\.\d+)\.exe$/;
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

/** Compara versões "1.2.3": >0 se a é mais nova que b. */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function safeUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    throw new Error('endereço de download inválido na release');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`a release aponta para um endereço fora do GitHub (${url.hostname})`);
  return url.href;
}

async function getJSON(url) {
  const res = await net.fetch(safeUrl(url), { headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA } });
  if (res.status === 404) throw new Error('o repositório ainda não tem nenhuma versão publicada');
  if (res.status === 403 || res.status === 429) throw new Error('o GitHub limitou as consultas por agora. Tente de novo daqui a uma hora');
  if (!res.ok) throw new Error(`o GitHub respondeu ${res.status}`);
  return res.json();
}

let latest = null; // última consulta: { version, notes, asset, digest, sumsUrl, htmlUrl }

async function check() {
  const rel = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`);
  const version = String(rel.tag_name || '').replace(/^v/, '');
  const asset = (rel.assets || []).find((a) => ASSET.test(a.name));
  const sums = (rel.assets || []).find((a) => a.name === 'SHA256SUMS.txt');
  const current = app.getVersion();
  const newer = !!version && compareVersions(version, current) > 0;
  latest = newer && asset ? { version, notes: String(rel.body || '').slice(0, 4000), asset, digest: asset.digest || null, sumsUrl: sums?.browser_download_url || null, htmlUrl: rel.html_url } : null;
  return {
    current,
    latest: version || null,
    available: !!latest,
    // há versão nova, mas no formato antigo (sem o instalador novo): só dá para baixar pelo site
    manualOnly: newer && !asset,
    notes: latest?.notes || '',
    size: latest?.asset.size || 0,
    url: rel.html_url || `https://github.com/${REPO}/releases`,
    canInstall: app.isPackaged && process.platform === 'win32',
  };
}

/** SHA-256 esperado: do SHA256SUMS.txt da release ou do digest que o GitHub informa. */
async function expectedHash() {
  if (latest.sumsUrl) {
    const res = await net.fetch(safeUrl(latest.sumsUrl), { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const text = await res.text();
      for (const line of text.split(/\r?\n/)) {
        const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
        if (m && m[2].trim() === latest.asset.name) return m[1].toLowerCase();
      }
    }
  }
  const d = String(latest.digest || '');
  if (/^sha256:[a-f0-9]{64}$/i.test(d)) return d.slice(7).toLowerCase();
  return null;
}

let downloaded = null;
let aborter = null;

async function download(onProgress) {
  if (!latest) throw new Error('procure atualizações primeiro');
  if (!app.isPackaged) throw new Error('a atualização só funciona no app instalado (este está rodando pelo código-fonte)');
  const want = await expectedHash();
  if (!want) throw new Error('a release não traz a soma de verificação (SHA256SUMS.txt). Por segurança, baixe pelo site do GitHub');
  const dir = path.join(app.getPath('temp'), 'frame-animator-update');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, latest.asset.name);
  aborter = new AbortController();
  const res = await net.fetch(safeUrl(latest.asset.browser_download_url), { headers: { 'User-Agent': UA }, signal: aborter.signal });
  if (!res.ok || !res.body) throw new Error(`o download falhou (${res.status})`);
  const total = Number(res.headers.get('content-length')) || latest.asset.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let got = 0;
  let lastSent = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      const now = Date.now();
      if (now - lastSent > 100) {
        lastSent = now;
        onProgress?.({ got, total });
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
    aborter = null;
  }
  onProgress?.({ got, total });
  if (hash.digest('hex') !== want) {
    await fsp.rm(file, { force: true });
    throw new Error('o arquivo baixado não confere com a soma de verificação da release (pode ter corrompido no caminho). Tente de novo');
  }
  downloaded = file;
  return { file, version: latest.version };
}

function cancel() {
  aborter?.abort();
}

/** Abre o instalador em modo atualização e fecha o app; ele reabre o app quando terminar. */
function install() {
  if (!downloaded) throw new Error('baixe a atualização primeiro');
  const exe = process.execPath;
  // cwd fora da pasta do app: um processo com a pasta atual dentro dela impede o Windows de trocá-la
  const child = spawn(downloaded, ['--update', '--dir', path.dirname(exe), '--pid', String(process.pid)], { detached: true, stdio: 'ignore', cwd: path.dirname(downloaded) });
  child.unref();
  setTimeout(() => app.quit(), 300);
}

module.exports = { check, download, cancel, install, compareVersions };
