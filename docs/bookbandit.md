# BookBandit

[BookBandit](https://github.com/Spacegoose02/bookbandit) is the family's book library and reader. Linked to Den Duty, the reading kids do in it counts toward their **Reading practice**, and finishing a book can pay a bonus.

## Setting it up

1. Give each kid a practice for reading on their board (for example "📚 Reading, 20 minutes, 5 days a week").
2. In **Settings → Home Assistant and API tokens**, make a **control** token named BookBandit.
3. In BookBandit (Settings, Den Duty), paste Den Duty's address, your home id and the token, then pick each kid and their Reading practice.
4. Optional: in **Settings → BookBandit**, set the **Finished a book** bonus (0 = off) and whether a grown-up checks finished books first.

## What happens

- Every few minutes BookBandit sends each kid's reading minutes for the day. They go into the kid's practice like a kid's own "I did it!": a practice that needs an OK waits for a grown-up on the parent home, a trusted one counts straight away, and the practice's points pay once a day.
- BookBandit sends its running total for the day each time. Den Duty keeps it apart from the kid's own taps, so a repeated report only adds the difference, and the kid's own practice still counts on top.
- A finished book pays the bonus once per book. When finished books need an OK, they wait on the parent home's **Practice to check** card; "Not yet" means no bonus for that book. The ledger row names the book.
- BookBandit can catch up on the last 7 days of reading (for books read offline). A kid whose Practice page is switched off isn't logged.

## API

`GET /api/v1/homes/:homeId/kids/:kidId/habits` (read token) lists a kid's practices, so BookBandit can offer them.

`POST /api/v1/homes/:homeId/reading/report` (control token):

```json
{
  "kids": [
    { "kidId": "…", "habitId": "…", "date": "2026-11-14", "minutes": 35, "finished": [{ "id": "book-uuid", "title": "The Hobbit" }] }
  ]
}
```

- `date` is the day in the home's time zone. `minutes` is 0 to 1440, the running total BookBandit counted that day.
- Unknown kid or habit ids, a habit that isn't that kid's, and dates outside the last 7 days are skipped, not errors.

Answer:

```json
{ "ok": true, "kids": [{ "kidId": "…", "minutes": 35, "habitPaid": 3, "finishedPaid": 10 }] }
```

`minutes` is what Den Duty has from BookBandit for that day. `habitPaid` and `finishedPaid` are the points this report paid (0 when nothing new was paid, or it is waiting for a grown-up).
