# Background music — sources and licences

Mystic Witch LIVE ships ten instrumental background tracks. Every file comes from
Pixabay and is covered by the **Pixabay Content License**
(<https://pixabay.com/service/license-summary/>): free for commercial use,
including monetised video and livestreams, and no attribution is required
(crediting the artists below is still appreciated).

No track is ripped from YouTube, no copyrighted commercial music is used, and no
file plays a voice or lyric. Only audio files were downloaded — no videos.

Downloaded on 2026-11-02.

| File | Title | Artist | Length | Source page |
| --- | --- | --- | --- | --- |
| `mystic-chamber.mp3` | Dark Ambient Atmosphère 1 | danydory | 2:05 | <https://pixabay.com/music/mystery-dark-ambient-atmosph%C3%A8re-1-141313/> |
| `dark-oracle.mp3` | Mystical | leberch | 2:54 | <https://pixabay.com/music/ambient-mystical-516605/> |
| `spirit-realm.mp3` | Ethereal | leberch | 5:54 | <https://pixabay.com/music/ambient-ethereal-511852/> |
| `tarot-reading.mp3` | Parlor of Secrets – Vintage Witchy Tarot Instrumental | MoonpetalMedia | 2:43 | <https://pixabay.com/music/pop-parlor-of-secrets-vintage-witchy-tarot-instrumental-537898/> |
| `witch-ritual.mp3` | Blue Hour Archive — Dark Academia Ambient for Reading & Focus | The217AMLibrary | 2:59 | <https://pixabay.com/music/ambient-blue-hour-archive-dark-academia-ambient-for-reading-amp-focus-575465/> |
| `enchanted-forest.mp3` | Fantasy Ambient | leberch | 6:28 | <https://pixabay.com/music/ambient-fantasy-ambient-586801/> |
| `moonlight-prophecy.mp3` | Moonlight In The Water — Glimmering Ambient Music for Relaxation | JuliusH | 1:42 | <https://pixabay.com/music/ambient-moonlight-in-the-water-glimmering-ambient-music-for-relaxation-128965/> |
| `ancient-mystery.mp3` | Ancient Mystery | Sonican | 2:34 | <https://pixabay.com/music/mystery-ancient-mystery-238994/> |
| `dark-sanctum.mp3` | Dark Ambient Atmosphère 2 | danydory | 1:27 | <https://pixabay.com/music/ambient-dark-ambient-atmosph%C3%A8re-2-141314/> |
| `deep-trance.mp3` | Ambient Deep Session 3 | Michael-X_Studio | 5:32 | <https://pixabay.com/music/ambient-ambient-deep-session-3-464341/> |

## Processing applied to every file

Each source was re-encoded once with ffmpeg so the stream has a predictable,
background-friendly level (equal `loudnorm` gain moves the whole bed, it does not
compress the music):

```
ffmpeg -i source.mp3 \
  -af "loudnorm=I=-21:TP=-2:LRA=7,afade=t=in:st=0:d=2,afade=t=out:st=<dur-3>:d=3" \
  -ar 44100 -ac 2 -c:a libmp3lame -b:a 128k <name>.mp3
```

- −21 LUFS integrated, −2 dBTP ceiling: sits under narration without pumping.
- 2 s fade in / 3 s fade out so track changes never click.
- 44.1 kHz stereo, 128 kbps — ~1 MB per minute.

## Candidates that were rejected

Two harvested tracks were dropped before installation because their dynamic range
(EBU R128 LRA ≈ 10, versus ≈ 2–4 for the rest) would have produced sudden swells
under a quiet tarot reading:

- "Mystery Mysterious Mystical" — SolarFLEX
- "Ethereal Ambient" — AtlasAudio

## The previous collection

The eight Sunny Side Sips café tracks (`sunny-morning`, `summer-lemonade`,
`happy-cafe`, `weekend-vibes`, `beachside-drive`, `coffee-break`, `good-times`,
`little-sunshine`) were removed from `public/assets/music/` and are kept out of
version control in `backups/music-sunny-side-sips-<date>/`. They were original,
locally synthesised instrumentals (the old `tools/generate_music.py`), so no
licence obligation is attached to the copy.
