import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// A stable content version changes URLs only when the deployed files change.
export async function stampAssets(directory = 'public') {
  const names = (await readdir(directory)).filter(name => /\.(?:html|js|css|svg|json|zip)$/.test(name) && name !== 'build-info.json').sort();
  const normalize = text => text.replace(/\?v=[a-f0-9]{16}(?=["'])/g, '').replace(/data-app-build="[a-f0-9]*"/g, 'data-app-build=""');
  const hash = createHash('sha256'), contents = new Map();
  for (const name of names) {
    const bytes = await readFile(path.join(directory, name));
    const content = name.endsWith('.zip') ? bytes : normalize(bytes.toString('utf8'));
    contents.set(name, content); hash.update(name).update('\0').update(content).update('\0');
  }
  const version = hash.digest('hex').slice(0, 16);
  const escaped = names.filter(name => /\.(?:js|css|svg|zip)$/.test(name)).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const reference = new RegExp(`(["'])(/(?:${escaped.join('|')}))\\1`, 'g');
  for (const [name, content] of contents) {
    if (!/\.(?:html|js)$/.test(name)) continue;
    const stamped = content.replace(reference, (_, quote, url) => `${quote}${url}?v=${version}${quote}`).replace(/data-app-build=""/g, `data-app-build="${version}"`);
    await writeFile(path.join(directory, name), stamped);
  }
  await writeFile(path.join(directory, 'build-info.json'), JSON.stringify({ version }) + '\n');
  return version;
}
