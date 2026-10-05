// @corpus class=string expect=ok
// @corpus note=split/join used as replace-all ('"' -> '""') inside a single-parameter, expression-bodied map arrow; the template literal interpolates strings only. [] and [""] both give "" (row ambiguity); "".split('"') is [""], not [].

/**
 * Formats one CSV record (RFC 4180 style): fields containing a comma, double quote, CR or LF
 * are wrapped in double quotes, and embedded double quotes are doubled.
 *
 * @example toCsvRow(["a", "b,c", 'say "hi"']) // 'a,"b,c","say ""hi"""'
 * @example toCsvRow([])                       // ""
 */
export function toCsvRow(fields: string[]): string {
  return fields
    .map((field) =>
      field.indexOf(",") !== -1 ||
      field.indexOf('"') !== -1 ||
      field.indexOf("\n") !== -1 ||
      field.indexOf("\r") !== -1
        ? `"${field.split('"').join('""')}"`
        : field,
    )
    .join(",");
}
