export const COPY = `\A line of text is not a neutral thing. It has mass. It has a beginning that carries momentum into the middle, and a middle that either spends that momentum or saves it for the end. The end either resolves or refuses. Most lines refuse. They stop because they ran out of room, not because they had anything to say about stopping. That is the difference between a line and a sentence: a sentence knows when it is finished.

Typography is the art of making lines that know when they are finished. It is also the art of making columns that hold their shape under pressure — under the pressure of words that are too long, of phrases that want to stay together, of punctuation that insists on belonging to what came before it rather than what comes after.

The column is a container. But it is a container with opinions. It decides, through its width and its margins and its leading, what kind of reading it wants to be. A narrow column is urgent. A wide column is contemplative. A ragged right edge is honest about the difficulty of fitting language into rectangles. A justified column is a lie that we have agreed to tell each other because the alternative — all those loose ends — seems somehow less serious.

Seriousness is a typographic quality. So is playfulness. So is grief. The same words set in different faces at different sizes in different columns produce different emotional temperatures, and this is not a metaphor. It is a physical fact about how the eye moves and what the eye expects and what happens when expectation is met or denied.

Pretext does not care about emotion. Pretext cares about measurement. It measures the width of segments with the browser's own font engine, caches those widths, and then lets layout be arithmetic — pure and fast and repeatable. No DOM. No reflow. No synchronous reads that stall the rendering pipeline. Just numbers, and the geometry that follows from numbers.

But here is what is interesting: measurement is not neutral either. The decision to measure at the word boundary rather than the character boundary is a typographic decision. The decision to honor soft hyphens as discretionary break points is a typographic decision. The decision to treat Arabic punctuation clusters as units that refuse to break internally — that is a decision about what language is and how it should be held.

Every line break is a decision. Every line break is also a small act of violence against the sentence, which did not ask to be interrupted. Good typography makes the interruption feel inevitable. Great typography makes you forget that the interruption happened at all.

The column you are reading has a shape. That shape is being computed sixty times per second by a loop that knows nothing about meaning and everything about width. It knows that this word is 47 pixels wide and that word is 31 pixels wide and that the available space is contracting because something — a hull, a wave, an obstacle with its own agenda — is pushing in from the side.

When the available space contracts, decisions have to be made. Does this word stay on this line or fall to the next? Does this phrase survive intact or get split across a break? The layout engine does not agonize over these questions. It applies rules derived from Unicode line-breaking specifications, modified by years of empirical testing against real browser behavior, and it answers in microseconds.

The words do not know they are being measured. The reader does not know either, which is the point. The machinery should be invisible. What should be visible is the text, sitting in its column, holding its shape, doing the thing that text is supposed to do: transmit something from one mind to another across a distance that is partly spatial and partly temporal and partly just the ordinary strangeness of trying to mean something to someone you cannot see.

Type small. Type large. Set it ragged or set it tight. Wrap it around an obstacle that breathes with the music. Watch the line breaks shift in real time as the hull expands and contracts, as the wave climbs and recedes, as the geometry of the available space changes faster than reading can follow. The text does not care. It reorganizes. It finds its new shape. It keeps going.

That is what columns do. They keep going. Even when the space is strange. Even when the obstacle is in the way. Even when the measure changes mid-line and the engine has to decide, in the middle of laying out a sentence about stopping, whether to stop now or to carry on for a few more words before the column ends and the silence begins.

There is a rhythm to this. If you listen, you can hear it. Not in the words — the words are quiet. In the layout itself. In the way the line count climbs when the hull shrinks, and falls when the hull retreats. In the way certain phrases always break at the same place because their syllable structure and the column width have reached some kind of agreement. In the way a single long word can hold a whole paragraph hostage until the available width is generous enough to let it pass.

This is cadence. Not the cadence of speech — the cadence of space. The rhythm of measure and break and carry and conclude. You cannot hear it with your ears. But if you have been reading long enough, you can feel it in your eyes.

Mixed scripts stay honest here. Arabic text like بدأت الرحلة ومضت السفينة participates in the same measurement loop as the Latin text around it. CJK characters like 每行文字都有重量 和节奏 break at the ideograph boundary because that is where they want to break. Emoji like 🌊 🌀 ✦ are measured at their rendered width, which differs from their nominal size, which is a bug that has been promoted to a feature by virtue of being unfixable.

Numbers: 3.14159265358979. Ranges: 7:00–9:00. URLs: https://example.com/?mode=obstacle&shape=blob&track=electronic-chill. These are the things that columns have to deal with in the real world, and the real world is stranger than the examples in the Unicode specification ever quite anticipated.

The specification imagined Latin text. It extended itself, carefully, to Indic scripts and Arabic scripts and CJK scripts and scripts that most people in the room had never heard of. It tried to cover Myanmar and Tibetan and Mongolian and the edge cases of Hebrew vowel marks and the behavior of the Arabic kasra when it appears at a line boundary. It did its best. The best was not enough, and every layout engine since has been a negotiation between the specification and the browser and the font and the text and the column and the reader who just wants the words to be where they are supposed to be.

Pretext measures once. Everything after that is arithmetic. This is either a profound insight about the nature of typography or a very efficient caching strategy, depending on how much you care about the difference.

The column does not care. The column is forty pixels narrower than it was a moment ago, because the obstacle moved, and now the line count has changed, and the text has reorganized itself into a new shape, and somewhere in that new shape there is a sentence that was previously whole and is now split across two lines at a boundary that neither the writer nor the reader would have chosen, but which the geometry required.

That is fine. The geometry is always requiring something. The text is always reorganizing. The column is always holding its shape, or trying to, against whatever is pushing in from outside.

Keep reading. The column keeps going. The loop runs at sixty frames per second. The font engine has already answered every question that mattered before you finished reading this sentence, and the next one, and the one after that.`