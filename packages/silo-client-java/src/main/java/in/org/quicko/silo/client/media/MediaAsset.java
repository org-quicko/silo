package in.org.quicko.silo.client.media;

import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.scope.DeleteOptions;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * A catalogued asset, live: the record plus the operations on it. A mutating
 * call adopts the server's answer in place and returns {@code this}.
 *
 * <p>{@link #reference()} is what an entry field should hold. {@link #url()} is
 * only where to fetch today's bytes: a rename or a move keeps the same reference
 * but can change the URL, so storing a URL in an entry is the mistake a later
 * rename silently breaks.
 */
public final class MediaAsset {
  private final Transport transport;
  private MediaAssetRecord state;

  public MediaAsset(Transport transport, MediaAssetRecord state) {
    this.transport = transport;
    this.state = state;
  }

  /** Everything this asset is, as a value that can be logged or cached. */
  public MediaAssetRecord record() {
    return state;
  }

  public String id() {
    return state.id();
  }

  public String filename() {
    return state.filename();
  }

  public String folder() {
    return state.folder();
  }

  public String blobKey() {
    return state.blobKey();
  }

  public long sizeInBytes() {
    return state.sizeInBytes();
  }

  public String contentType() {
    return state.contentType();
  }

  public String hash() {
    return state.hash();
  }

  public MediaState state() {
    return state.state();
  }

  public List<String> tags() {
    return state.tags();
  }

  public String url() {
    return state.url();
  }

  public long usageCount() {
    return state.usageCount();
  }

  public Instant createdAt() {
    return state.createdAt();
  }

  public Instant updatedAt() {
    return state.updatedAt();
  }

  /** {@code silo://media/<id>} — store this in an entry field, never the URL. */
  public String reference() {
    return MediaReference.of(id());
  }

  public MediaAsset rename(String filename) {
    return rename(filename, RequestOptions.none());
  }

  public MediaAsset rename(String filename, RequestOptions options) {
    return patch(Map.of("filename", filename), options);
  }

  public MediaAsset moveTo(String folder) {
    return moveTo(folder, RequestOptions.none());
  }

  public MediaAsset moveTo(String folder, RequestOptions options) {
    return patch(Map.of("folder", folder), options);
  }

  public MediaAsset setTags(List<String> tags) {
    return setTags(tags, RequestOptions.none());
  }

  /** REPLACES the tag list: the route replaces, it does not append. */
  public MediaAsset setTags(List<String> tags, RequestOptions options) {
    return patch(Map.of("tags", List.copyOf(tags)), options);
  }

  public MediaAsset replace(MediaReplace input) {
    return replace(input, RequestOptions.none());
  }

  /**
   * Swaps the bytes behind this asset. The id, the reference, the URL, the
   * filename and the folder all survive; the hash, the size and the content type
   * are re-read from the server's answer.
   *
   * <p>Every entry referencing it now resolves to the new file, without any of
   * them being rewritten — which is the point, and the reason the server asks for
   * {@code media:replace} and for {@code entries:update} at every scope that
   * refers to it.
   */
  public MediaAsset replace(MediaReplace input, RequestOptions options) {
    state = MediaMapper.toRecord(transport.upload(
        TransportRequest.post(ApiPath.mediaAssetContent(id())).options(options).build(),
        MediaParts.form(input.bytes(), input.filename(), input.contentType(), null)));
    return this;
  }

  public void delete() {
    delete(DeleteOptions.none());
  }

  /** Refused while an entry references it. Forcing also needs
   *  {@code entries:update} on every scope this asset reaches. */
  public void delete(DeleteOptions options) {
    transport.empty(
        TransportRequest.delete(ApiPath.mediaAsset(id()))
            .query("force", options.force() ? true : null)
            .options(options.request())
            .build());
  }

  public MediaUsagePage usages() {
    return usages(MediaUsageQuery.all(), RequestOptions.none());
  }

  /** Which entries reference this asset, as far as this key may see. */
  public MediaUsagePage usages(MediaUsageQuery query, RequestOptions options) {
    return MediaUsagePage.first(transport, id(), query, options);
  }

  public MediaAsset refresh() {
    return refresh(RequestOptions.none());
  }

  public MediaAsset refresh(RequestOptions options) {
    state = MediaMapper.toRecord(transport.json(
        TransportRequest.get(ApiPath.mediaAsset(id())).options(options).build()));
    return this;
  }

  private MediaAsset patch(Map<String, Object> body, RequestOptions options) {
    state = MediaMapper.toRecord(transport.json(
        TransportRequest.patch(ApiPath.mediaAsset(id())).body(body).options(options).build()));
    return this;
  }
}
