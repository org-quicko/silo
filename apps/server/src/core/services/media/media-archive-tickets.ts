import crypto from "crypto";
import { MediaArchiveLimits } from "../../media/media-archive-limits";
import type { MediaArchivePlan } from "../../media/media-archive-plan";

/** A prepared download: the plan, and the unguessable id its part URLs carry. */
export interface MediaArchiveTicket {
  id: string;
  expiresAt: Date;
  plan: MediaArchivePlan;
}

/**
 * Prepared downloads, held in this process until they expire (D106). A
 * browser follows a part's URL as a plain navigation, which sends no API key,
 * so the ticket id is the credential, the way a signed URL is.
 */
export class MediaArchiveTickets {
  private readonly tickets = new Map<string, MediaArchiveTicket>();

  issue(plan: MediaArchivePlan, now: number = Date.now()): MediaArchiveTicket {
    this.sweep(now);
    while (this.tickets.size >= MediaArchiveLimits.MaxTickets) {
      const oldest = this.tickets.keys().next().value;
      if (oldest === undefined) break;
      this.tickets.delete(oldest);
    }
    const ticket: MediaArchiveTicket = {
      id: crypto.randomBytes(24).toString("base64url"),
      expiresAt: new Date(now + MediaArchiveLimits.TicketLifetimeMs),
      plan,
    };
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  find(id: string, now: number = Date.now()): MediaArchiveTicket | null {
    const ticket = this.tickets.get(id);
    if (!ticket) return null;
    if (ticket.expiresAt.getTime() <= now) {
      this.tickets.delete(id);
      return null;
    }
    return ticket;
  }

  private sweep(now: number): void {
    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAt.getTime() <= now) this.tickets.delete(id);
    }
  }
}
