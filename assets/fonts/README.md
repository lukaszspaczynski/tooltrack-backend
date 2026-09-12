# Fonts

`DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`, version 2.37, from
<https://dejavu-fonts.github.io>. `LICENSE.txt` is theirs, verbatim: a free
licence that permits redistribution, which is why these files can sit in the
repository at all.

They are here because the fourteen fonts built into every PDF reader are
encoded in WinAnsi, which has no `ł`, `ą`, `ę`, `ś`, `ż`, `ź`, `ć` or `ń` — and
a label carrying a tool's name in Polish would come out mangled. pdf-lib
embeds these instead, subsetted to the glyphs each label actually uses, so the
size on disk here is not the size in the PDF.
