# usage

Yet another streaming service.
Stations:
%stations%
Commands:
  */radio [frequency]*
  */radio stop*
Example:
  */radio 59*

# station

<!-- One line of %stations% above. -->

  %frequency%: *"%name%"*

# missing

Station does not exist.

# loading

Loading station: "%station%"

# playing

Now playing: %artist% - "%title%"

# playing-with-extras

<!-- %extras% are links to a track's other files: its cover, its lyrics. -->

Now playing: %artist% - "%title%" (%extras%)

# unreachable

Failed to receive the station from its seed! (%seed%)

# failed

Failed to play track.
