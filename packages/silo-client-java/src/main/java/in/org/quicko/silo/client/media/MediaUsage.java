package in.org.quicko.silo.client.media;

/**
 * One entry's reference to a media asset, mapped from the wire's snake_case
 * ({@code media_id}, {@code env}, {@code entry_id}) by {@link MediaMapper}.
 *
 * <p>The one referrer type across the client: {@link MediaUsagePage} and
 * {@link in.org.quicko.silo.client.errors.MediaInUseException} both use this
 * rather than each declaring their own.
 */
public record MediaUsage(
    String mediaId, String project, String environment, String collection, String entryId) {}
