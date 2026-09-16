package in.org.quicko.silo.client.support;

import java.util.List;

/** The field type the collection tests read entries into. */
public class Post {
  public String title;
  public String status;
  public List<String> tags;

  public Post() {}

  public Post(String title, String status, List<String> tags) {
    this.title = title;
    this.status = status;
    this.tags = tags;
  }
}
