/**
 * One 512-byte POSIX ustar header block.
 *
 * Silo writes tar rather than delegating it because the archive has to be
 * produced entry by entry as the export walk finds them — see §7.1 in
 * [docs/design/transfer.md](../../../../../../docs/design/transfer.md). Reading
 * is still `tar.x`; only the writer is ours.
 */
export class TarHeader {
  static readonly BlockSize = 512;

  /** The longest path a ustar `name` field holds. Anything longer needs a
   *  preceding PAX record, which `TarWriter` emits. */
  static readonly MaxNameLength = 100;

  /** A regular file. */
  static readonly TypeFile = "0";
  /** A directory: size is always zero and the path ends in a slash. */
  static readonly TypeDirectory = "5";
  /** A PAX extended header, whose payload describes the entry that follows. */
  static readonly TypeExtendedHeader = "x";

  /**
   * Build the block.
   *
   * `mtime` is a caller-chosen instant rather than the clock, which is what
   * makes two exports of unchanged data identical byte for byte — the property
   * §7.1 claims and that staging through real files could never deliver.
   */
  static build(options: {
    path: string;
    size: number;
    type: string;
    mode: number;
    mtime: Date;
  }): Uint8Array {
    const block = new Uint8Array(TarHeader.BlockSize);
    const name = new TextEncoder().encode(options.path);

    // Over-long names are truncated here on purpose: the PAX record that
    // precedes them carries the real path, and a reader that ignores PAX gets
    // a recognisable prefix instead of a corrupt block.
    block.set(name.subarray(0, TarHeader.MaxNameLength), 0);

    TarHeader.writeOctal(block, 100, 8, options.mode);
    TarHeader.writeOctal(block, 108, 8, 0);
    TarHeader.writeOctal(block, 116, 8, 0);
    TarHeader.writeOctal(block, 124, 12, options.size);
    TarHeader.writeOctal(block, 136, 12, Math.floor(options.mtime.getTime() / 1000));
    block[156] = options.type.charCodeAt(0);
    TarHeader.writeAscii(block, 257, "ustar\0");
    TarHeader.writeAscii(block, 263, "00");

    TarHeader.writeChecksum(block);
    return block;
  }

  /**
   * The payload of a PAX extended header: one `len key=value\n` record per
   * field, where `len` counts itself.
   */
  static extendedRecord(key: string, value: string): Uint8Array {
    const encoder = new TextEncoder();
    const body = ` ${key}=${value}\n`;
    let length = encoder.encode(body).length + 1;
    // The declared length includes its own digits, so adding a digit can push
    // it over the next power of ten and change the answer again.
    while (encoder.encode(`${length}${body}`).length !== length) {
      length = encoder.encode(`${length}${body}`).length;
    }
    return encoder.encode(`${length}${body}`);
  }

  /** Bytes of padding that follow `size` bytes of data. */
  static padding(size: number): number {
    const remainder = size % TarHeader.BlockSize;
    return remainder === 0 ? 0 : TarHeader.BlockSize - remainder;
  }

  private static writeAscii(block: Uint8Array, offset: number, value: string): void {
    for (let index = 0; index < value.length; index++) {
      block[offset + index] = value.charCodeAt(index);
    }
  }

  /** `width - 1` octal digits, zero-padded, then a NUL — the widest form every
   *  reader accepts. */
  private static writeOctal(block: Uint8Array, offset: number, width: number, value: number): void {
    const digits = Math.max(0, Math.floor(value)).toString(8).padStart(width - 1, "0");
    TarHeader.writeAscii(block, offset, digits.slice(-(width - 1)));
    block[offset + width - 1] = 0;
  }

  /**
   * The unsigned sum of every byte, computed with the checksum field itself
   * read as eight spaces, then written back over it as six octal digits, a NUL
   * and a space.
   */
  private static writeChecksum(block: Uint8Array): void {
    for (let index = 148; index < 156; index++) block[index] = 0x20;
    let sum = 0;
    for (const byte of block) sum += byte;
    TarHeader.writeAscii(block, 148, sum.toString(8).padStart(6, "0").slice(-6));
    block[154] = 0;
    block[155] = 0x20;
  }
}
