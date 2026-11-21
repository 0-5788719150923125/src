# text

Everything the terminal says, by language: `en/` is English. A translation
is a copy of `en/` under its own language code, with the words changed and
everything else left as it is.

## Files

Each file holds entries. A line `# name` starts one, and it runs to the
next. The code asks for an entry by file and name: `radio.md`, `# missing`
is `radio.missing`. Anything before the first entry, and anything in
`<!-- comments -->`, is a note for whoever edits the file.

## Writing

Entries are Markdown, as a terminal prints it:

- **A line is a line.** Every line break is printed, so write each paragraph
  on one line, and break lines only where the terminal should.
- **Spaces are kept** at the start of a line and in runs of two or more, for
  indents and columns: `  */radio stop*` prints indented.
- `*italics*`, `**bold**`, `~~struck~~`, `[a link](https://...)`,
  `![an image](assets/name.png)`, `## headings`, `- lists` and `1. lists`
  (nested by indenting), and ` ``` ` fences around text printed exactly.
- **Colors:** `[words]{.core}` (red), `{.root}` (green), `{.fold}` (blue),
  `{.good}` (purple), `{.bad}` (on purple), `{.missing}` (black on white).
- **Macros:** `%name%` is filled in when the line is printed (a date, a key,
  a station). Keep each one; move it wherever the sentence needs it.
- HTML tags pass through as they are, for what Markdown lacks (`<u>`).

The build bundles each language into one file (`build/site/text/en.js`), so
an edit shows on the next refresh of the dev server.
