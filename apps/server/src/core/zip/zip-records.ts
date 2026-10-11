/** The fixed-layout records of a STORE-only ZIP (APPNOTE 6.3), little endian. */
export class ZipRecords {
  static readonly LocalHeaderSignature = 0x04034b50;
  static readonly DescriptorSignature = 0x08074b50;
  static readonly CentralHeaderSignature = 0x02014b50;
  static readonly EndSignature = 0x06054b50;

  private static readonly Utf8Flag = 0x0800;
  private static readonly DescriptorFlag = 0x0008;
  private static readonly VersionNeeded = 20;
  /** Unix, spec 2.0, so extractors honour the permission bits below. */
  private static readonly VersionMadeBy = (3 << 8) | 20;
  private static readonly FileAttributes = (0o100644 << 16) >>> 0;
  private static readonly DirectoryAttributes = ((0o40755 << 16) | 0x10) >>> 0;

  /** A file's sizes and CRC follow its bytes in a descriptor; a directory has none. */
  static localHeader(name: Uint8Array, modified: Date, directory: boolean): Uint8Array {
    const extra = ZipRecords.timestamp(modified);
    const bytes = new Uint8Array(30 + name.length + extra.length);
    const view = new DataView(bytes.buffer);
    const { time, date } = ZipRecords.dos(modified);
    view.setUint32(0, ZipRecords.LocalHeaderSignature, true);
    view.setUint16(4, ZipRecords.VersionNeeded, true);
    view.setUint16(6, ZipRecords.flags(directory), true);
    view.setUint16(8, 0, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, extra.length, true);
    bytes.set(name, 30);
    bytes.set(extra, 30 + name.length);
    return bytes;
  }

  static dataDescriptor(crc: number, size: number): Uint8Array {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ZipRecords.DescriptorSignature, true);
    view.setUint32(4, crc, true);
    view.setUint32(8, size, true);
    view.setUint32(12, size, true);
    return bytes;
  }

  static centralHeader(entry: {
    name: Uint8Array;
    modified: Date;
    directory: boolean;
    crc: number;
    size: number;
    offset: number;
  }): Uint8Array {
    const extra = ZipRecords.timestamp(entry.modified);
    const bytes = new Uint8Array(46 + entry.name.length + extra.length);
    const view = new DataView(bytes.buffer);
    const { time, date } = ZipRecords.dos(entry.modified);
    view.setUint32(0, ZipRecords.CentralHeaderSignature, true);
    view.setUint16(4, ZipRecords.VersionMadeBy, true);
    view.setUint16(6, ZipRecords.VersionNeeded, true);
    view.setUint16(8, ZipRecords.flags(entry.directory), true);
    view.setUint16(10, 0, true);
    view.setUint16(12, time, true);
    view.setUint16(14, date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint16(30, extra.length, true);
    view.setUint32(38, entry.directory ? ZipRecords.DirectoryAttributes : ZipRecords.FileAttributes, true);
    view.setUint32(42, entry.offset, true);
    bytes.set(entry.name, 46);
    bytes.set(extra, 46 + entry.name.length);
    return bytes;
  }

  static end(count: number, centralSize: number, centralOffset: number): Uint8Array {
    const bytes = new Uint8Array(22);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, ZipRecords.EndSignature, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    return bytes;
  }

  private static flags(directory: boolean): number {
    return directory ? ZipRecords.Utf8Flag : ZipRecords.Utf8Flag | ZipRecords.DescriptorFlag;
  }

  /** The extended timestamp field (0x5455): the UTC mtime DOS time cannot carry. */
  private static timestamp(modified: Date): Uint8Array {
    const bytes = new Uint8Array(9);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0x5455, true);
    view.setUint16(2, 5, true);
    view.setUint8(4, 1);
    view.setUint32(5, Math.max(0, Math.floor(modified.getTime() / 1000)) >>> 0, true);
    return bytes;
  }

  private static dos(modified: Date): { time: number; date: number } {
    if (modified.getUTCFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
    return {
      time: (modified.getUTCHours() << 11) | (modified.getUTCMinutes() << 5) | (modified.getUTCSeconds() >> 1),
      date: ((modified.getUTCFullYear() - 1980) << 9) | ((modified.getUTCMonth() + 1) << 5) | modified.getUTCDate(),
    };
  }
}
