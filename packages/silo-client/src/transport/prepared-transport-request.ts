/** One request after its final URL, headers and body have been prepared. */
export interface PreparedTransportRequest {
  url: string;
  headers: Headers;
  body: BodyInit | undefined;
}
