package in.org.quicko.silo.client;

import static org.junit.jupiter.api.Assertions.assertEquals;

import in.org.quicko.silo.client.transport.ApiPath;
import org.junit.jupiter.api.Test;

class ApiPathTest {

  @Test
  void buildsTheEntryPath() {
    assertEquals(
        "/api/projects/acme/envs/prod/collections/posts/01ABC",
        ApiPath.entry("acme", "prod", "posts", "01ABC"));
  }

  @Test
  void encodesASegmentHoldingASlashSoItAddressesOneResource() {
    assertEquals("/api/projects/a%2Fb/envs/prod", ApiPath.environment("a/b", "prod"));
  }

  @Test
  void encodesASpaceAsAPercentEscapeRatherThanAPlus() {
    assertEquals("/api/projects/my%20project", ApiPath.project("my project"));
  }

  @Test
  void leavesTheUnreservedSetOfEncodeUriComponentAlone() {
    assertEquals("-_.!~*'()", ApiPath.segment("-_.!~*'()"));
  }

  @Test
  void encodesNonAsciiAsUtf8Octets() {
    assertEquals("caf%C3%A9", ApiPath.segment("café"));
  }

  @Test
  void usesTheEnvsSpellingOfTheTwoTheApiAccepts() {
    assertEquals("/api/projects/acme/envs", ApiPath.environments("acme"));
  }
}
