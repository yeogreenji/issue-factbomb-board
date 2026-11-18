/** 카드뉴스 PNG 5장을 파일 하나로 묶는 아주 작은 ZIP 작성기(무압축). 외부 라이브러리 없이 동작합니다. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date): { time: number; date: number } {
  return {
    time: ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff,
    date: (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  };
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const asPart = (view: Uint8Array): BlobPart => view as unknown as BlobPart;

export function buildZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const chunks: BlobPart[] = [];
  const central: BlobPart[] = [];
  const stamp = dosTime(new Date());
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8 파일명
    view.setUint16(8, 0, true); // 무압축
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    local.set(name, 30);
    chunks.push(asPart(local), asPart(entry.data));

    const header = new Uint8Array(46 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 20, true);
    hv.setUint16(8, 0x0800, true);
    hv.setUint16(10, 0, true);
    hv.setUint16(12, stamp.time, true);
    hv.setUint16(14, stamp.date, true);
    hv.setUint32(16, crc, true);
    hv.setUint32(20, entry.data.length, true);
    hv.setUint32(24, entry.data.length, true);
    hv.setUint16(28, name.length, true);
    hv.setUint16(30, 0, true);
    hv.setUint16(32, 0, true);
    hv.setUint16(34, 0, true);
    hv.setUint16(36, 0, true);
    hv.setUint32(38, 0, true);
    hv.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);

    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + (part as Uint8Array).length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, asPart(end)], { type: "application/zip" });
}
