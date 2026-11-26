<!-- The browser extension's ghost text, written ahead of you in other
sites' text fields (extension/page.js, extension/host.js), and the /ghost
command that turns it on and off (extension/terminal.js). The site itself
never prints these. "info" is the extension's welcome line, in place of the
site's (pen.info). "preamble" is read by the model before what is typed in
a field, never printed. -->

# info

INFO: An AI on your device finishes your thoughts, here and in any text field. Press Tab to keep a word, or hold it to keep them all.

# usage

Everywhere: */ghost on*, */ghost off*. One site: */ghost on \<site\>*, */ghost off \<site\>* (*here* is the tab you are on).

# on-everywhere

Ghost text is [on]{.root} in other sites' text fields.

# off-everywhere

Ghost text is [off]{.core} in other sites' text fields.

# on-site

Ghost text is [on]{.root} at %site%.

# off-site

Ghost text is [off]{.core} at %site%.

# exceptions-on

<!-- %sites% is a comma-separated list. -->

On at: %sites%

# exceptions-off

Off at: %sites%

# unknown-site

Which site? The terminal cannot see this tab's address. Name it: */ghost off example.com*

# preamble

<!-- %title% is the page's title, %site% its address's host name. -->

Written on a web page, "%title%" (%site%).
