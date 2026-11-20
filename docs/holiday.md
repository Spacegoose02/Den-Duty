# Holiday mode 🎄

A seasonal layer for kid boards and the family wall, after [Nordpol Card](https://github.com/DKAnord/nordpol-card)
(MIT, see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)). It's **off** until a parent turns it on in
**Settings → Home → Holiday mode**:

- **Off** (the default), **On now**, or **On between dates** (for example Dec 1 to Jan 1). With dates it turns itself
  on on the start date and off after the end date, in the home's time zone.

## What kids see

- **Countdown with snow** to the big day (Christmas morning at 7:00 by default; title, day and time are yours).
  Picture-board kids see sleeps as moons instead of hours and minutes. Snow stays still for devices set to reduce motion.
- **Elf of the day**: one of 30 elves for each day of December, with a joke (tap for the answer) and a small kind task
  ("Help set the table"). Before December a trial elf fills in. Tapping **🧝 I did it!** waits for a grown-up on the
  parent home (unless you untick "A grown-up checks it first"), then pays the task's points (5 by default) through the
  ledger as a bonus. Once a day per kid.
- **Nice list meter**: read from the points ledger, nothing new to track. Chores done over the last two weeks make most
  of it; bonus chores, quick rewards and elf tasks push it up; penalties pull it down a little. The **elf log** is the
  latest ledger lines. The wall shows each kid's score.
- **🛷 Where is Santa?**: on the night before the big day, Santa flies east to west across a world map and lands at your
  place at the time you set (11:59 PM by default). Before that, the workshop status fills up and the elves post news.
  Hold the title, or tap **✈️ Test flight**, to fly the whole night in a minute. Set your place in Settings (or tap
  **Use this device's location**); without one the sleigh lands somewhere on your time zone line.
- **📹 North Pole cams**: four looping scenes (reindeer paddock, toy workshop, mailroom, bakery) that change with the
  morning, day and evening, with a REC dot and a live clock. A cam that can't play shows static and "SIGNAL LOST".

The family wall shows the countdown next to the cams, and the sleigh takes over on the big night.

## The cam videos

The scenes are AI-generated clips that Nordpol Card's author shares for personal family dashboards. They are **not**
in this repository. Pick one in Settings:

- **Stream the scenes** (default): the tablet plays them from Nordpol Card's GitHub release, so the tablet needs internet.
- **My own copies**: download the clips from the
  [Nordpol Card release](https://github.com/DKAnord/nordpol-card/releases/tag/v2.1.0), put `cam1_morning.mp4` …
  `cam4_evening.mp4` in a `holiday-cams` folder inside Den Duty's data folder (`/data/holiday-cams` in Docker), restart
  Den Duty, and leave the address as `/holiday-cams`. Or point it at any web address that serves the same file names.
- **No cams**.
