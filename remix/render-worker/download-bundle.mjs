import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';

const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
// Streaming, stored ZIP entries. No shell filenames or in-memory video buffers.
export async function writeVideoBundle(target, entries) {
  if (!entries.length || entries.length > 100) throw new Error('每次打包请选择1—100条成片。');
  const out = await fs.open(target, 'wx');
  const central = [];
  let position = 0;
  const write = async bytes => {
    let at = 0;
    while (at < bytes.length) { const { bytesWritten } = await out.write(bytes, at, bytes.length-at); at += bytesWritten; position += bytesWritten; }
  };
  try {
    for (const [i, entry] of entries.entries()) {
      const stat = await fs.stat(entry.path);
      if (position + stat.size > 2 * 1024 ** 3) throw new Error('本包超过2GB，请减少所选成片后分包下载。');
      const name = Buffer.from(String(i + 1).padStart(3, '0') + '-' + entry.name.replace(/[\\/\x00-\x1f]/g, '_'), 'utf8');
      const start = position;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x808, 6); header.writeUInt16LE(name.length, 26);
      await write(header); await write(name);
      let crc = 0xffffffff, size = 0;
      for await (const bytes of createReadStream(entry.path)) {
        for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
        size += bytes.length; await write(bytes);
      }
      if (size !== stat.size) throw new Error('打包期间文件发生变化，请重试。');
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(size, 8); descriptor.writeUInt32LE(size, 12); await write(descriptor);
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
      record.writeUInt16LE(0x808, 8); record.writeUInt32LE(crc, 16);
      record.writeUInt32LE(size, 20); record.writeUInt32LE(size, 24);
      record.writeUInt16LE(name.length, 28); record.writeUInt32LE(start, 42);
      central.push(Buffer.concat([record, name]));
    }
    const start = position;
    for (const bytes of central) await write(bytes);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(position - start, 12); end.writeUInt32LE(start, 16);
    await write(end);
  } catch (error) { await out.close(); await fs.rm(target, { force: true }); throw error; }
  await out.close();
}
