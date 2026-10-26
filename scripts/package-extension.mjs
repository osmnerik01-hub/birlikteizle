import { readdir, readFile, writeFile } from 'node:fs/promises';
// A small ZIP writer (stored entries) keeps packaging independent of OS tools.
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
const locals = [], central = []; let offset = 0, count = 0;
for (const name of (await readdir('extension')).sort()) {
  if (!/\.(js|json|html|css)$/.test(name)) continue;
  const bytes = await readFile(`extension/${name}`), filename = Buffer.from(name), crc = crc32(bytes);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
  locals.push(header, filename, bytes);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(0x21, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
  central.push(directory, filename); offset += header.length + filename.length + bytes.length; count++;
}
const centralSize = central.reduce((size, chunk) => size + chunk.length, 0), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
await writeFile('public/birlikteizle-extension.zip', Buffer.concat([...locals, ...central, end]));
console.log(`Chrome extension packaged (${count} files).`);
