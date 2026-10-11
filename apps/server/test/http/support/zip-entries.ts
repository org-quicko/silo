/**
 * Reads a ZIP through its central directory and checks every member's CRC,
 * with a table CRC of its own so the check does not share the writer's.
 * A directory reads as `null`.
 */
export class ZipEntries {
  private static readonly table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });

  static read(bytes: Uint8Array): Map<string, Uint8Array | null> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 22;
    if (view.getUint32(end, true) !== 0x06054b50) throw new Error("no end of central directory record");
    const count = view.getUint16(end + 10, true);
    let cursor = view.getUint32(end + 16, true);
    const entries = new Map<string, Uint8Array | null>();

    for (let index = 0; index < count; index++) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error(`bad central header ${index}`);
      const crc = view.getUint32(cursor + 16, true);
      const size = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const offset = view.getUint32(cursor + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength;

      if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      const data = bytes.slice(start, start + size);
      if (ZipEntries.crc(data) !== crc) throw new Error(`crc mismatch for ${name}`);
      entries.set(name, name.endsWith("/") ? null : data);
    }
    return entries;
  }

  private static crc(data: Uint8Array): number {
    let value = 0xffffffff;
    for (const byte of data) value = ZipEntries.table[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }
}
