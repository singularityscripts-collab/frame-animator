// Leitor de XML pequeno e tolerante (sem dependências), suficiente para o XFL do Animate.
// Devolve nós { name, attrs, children, text }.

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e] ?? m;
  });
}

export function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const e = src.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      const name = src.slice(lt + 2, e).trim();
      // fecha até achar o nome (tolera XML mal formado)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = e < 0 ? n : e + 1;
      continue;
    }
    // tag de abertura: acha o '>' fora de aspas
    let j = lt + 1, q = null;
    while (j < n) {
      const c = src[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
      j++;
    }
    let body = src.slice(lt + 1, j);
    const selfClose = body.endsWith('/');
    if (selfClose) body = body.slice(0, -1);
    const m = body.match(/^\s*([^\s/>]+)/);
    const node = { name: m ? m[1] : '', attrs: {}, children: [], text: '' };
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = re.exec(body))) node.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = j + 1;
  }
  return root.children.find((c) => c.name) || root;
}

/** Primeiro filho com o nome (ou caminho "a/b/c"). */
export function child(node, path) {
  let cur = node;
  for (const name of path.split('/')) {
    cur = cur?.children.find((c) => c.name === name);
    if (!cur) return null;
  }
  return cur;
}

/** Todos os filhos com o nome (no caminho "a/b" pega os filhos "b" de "a"). */
export function children(node, path) {
  const parts = path.split('/');
  const last = parts.pop();
  const parent = parts.length ? child(node, parts.join('/')) : node;
  return parent ? parent.children.filter((c) => c.name === last) : [];
}
