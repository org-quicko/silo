import { MediaArchiveBusyError } from "../../errors/media-archive-busy-error";
import { NotFoundError } from "../../errors/not-found-error";
import { MediaArchiveLimits } from "../../media/media-archive-limits";
import type { MediaArchivePart } from "../../media/media-archive-plan";
import { MediaArchiveSelection } from "../../media/media-archive-selection";
import type { ZipEntry } from "../../zip/zip-entry";
import { ZipWriter } from "../../zip/zip-writer";
import { MediaArchivePlanner } from "./media-archive-planner";
import { type MediaArchiveTicket, MediaArchiveTickets } from "./media-archive-tickets";
import type { MediaCatalogStore } from "./media-catalog-store";
import type { ServiceContext } from "../support/service-context";
import type { MediaDelivery } from "./media-delivery";

/** One archive part, ready to send. */
export interface MediaArchiveDownload {
  filename: string;
  body: ReadableStream<Uint8Array>;
}

/**
 * Bulk downloads (D106): a selection is planned once into ZIP parts, then
 * each part is streamed on request, a few at a time server-wide.
 */
export class MediaArchiveService {
  /** A slot a stream never gave back, say from a response nobody read, is
   *  reclaimed after this long. */
  private static readonly StaleSlotMs = 6 * 60 * 60 * 1000;
  private static readonly SkippedNote = "missing-files.txt";

  private readonly context: ServiceContext;
  private readonly planner: MediaArchivePlanner;
  private readonly delivery: MediaDelivery;
  private readonly tickets = new MediaArchiveTickets();
  private readonly slots = new Map<symbol, number>();

  constructor(context: ServiceContext, catalog: MediaCatalogStore, delivery: MediaDelivery) {
    this.context = context;
    this.planner = new MediaArchivePlanner(catalog);
    this.delivery = delivery;
  }

  /** Refuses up front when every slot is busy, so the caller hears why
   *  rather than a browser showing a failed download. */
  async prepare(body: unknown): Promise<MediaArchiveTicket> {
    const selection = MediaArchiveSelection.parse(body);
    const ceilings = MediaArchiveLimits.of(this.context.mediaConfig);
    this.assertSlotFree(ceilings.maxStreams);
    return this.tickets.issue(await this.planner.plan(selection, ceilings));
  }

  /** The part's name, without opening anything: what a `HEAD` needs. */
  part(ticketId: string, partNumber: number): MediaArchivePart {
    const part = Number.isInteger(partNumber) ? this.tickets.find(ticketId)?.plan.parts[partNumber - 1] : undefined;
    if (!part) throw new NotFoundError("this download has expired or does not exist; prepare it again");
    return part;
  }

  open(ticketId: string, partNumber: number): MediaArchiveDownload {
    const part = this.part(ticketId, partNumber);
    this.assertSlotFree(MediaArchiveLimits.of(this.context.mediaConfig).maxStreams);
    const slot = Symbol("archive");
    this.slots.set(slot, Date.now());
    return {
      filename: part.filename,
      body: ZipWriter.stream(this.entries(part), {
        skippedNote: (paths) => MediaArchiveService.note(paths),
        onClose: () => this.slots.delete(slot),
      }),
    };
  }

  private *entries(part: MediaArchivePart): Iterable<ZipEntry> {
    const now = new Date();
    for (const path of part.directories) yield { path, modified: now };
    for (const file of part.files) {
      yield { path: file.path, modified: file.modified, open: () => this.body(file.id) };
    }
  }

  private async body(id: string): Promise<ReadableStream<Uint8Array> | null> {
    const media = await this.delivery.open(id, null);
    if (!media) return null;
    return media.body instanceof Blob ? (media.body.stream() as ReadableStream<Uint8Array>) : media.body;
  }

  private assertSlotFree(maxStreams: number): void {
    const now = Date.now();
    for (const [slot, since] of this.slots) {
      if (now - since > MediaArchiveService.StaleSlotMs) this.slots.delete(slot);
    }
    if (this.slots.size >= maxStreams) throw new MediaArchiveBusyError(maxStreams);
  }

  private static note(paths: string[]): ZipEntry {
    const text = `These files could not be read, so they are not in this archive:\n\n${paths.join("\n")}\n`;
    return {
      path: MediaArchiveService.SkippedNote,
      modified: new Date(),
      open: async () => new Blob([text]).stream() as ReadableStream<Uint8Array>,
    };
  }
}
