<!-- The browser extension's ghost text: PEN@ROOT writing ahead of you in
other sites' text fields (extension/page.js, extension/host.js), and the
/ghost command that turns it on and off (extension/terminal.js). The site
itself never prints these. "preamble" is read by the model before what is
typed in a field, never printed. -->

# info

PEN@ROOT also writes ahead of you in other sites' text fields, here in this browser. What you type there is never sent anywhere readable: it asks the swarm's memory with an encrypted question that no peer can read. Tab keeps a word, or hold it to keep them all; Escape hides the guess. Never in password, payment or address fields.

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
