package in.org.quicko.silo.client.search;

/**
 * Where a match was found, split into three plain strings rather than one with
 * markers in it: the fragment is {@code before + match + after}.
 */
public record SearchSnippet(String path, String before, String match, String after) {}
