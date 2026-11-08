# Screen-time bank

Kids save up minutes of screen time and spend them in timed sessions from their board. When a session starts and ends, Den Duty tells Home Assistant, so it can switch the TV, a console or a device's internet on and off.

## Turning it on

**Settings → Screen-time bank**:

| Setting | Default | What it does |
| --- | --- | --- |
| Minutes per chore point | 5 | An approved 4-point chore puts 20 minutes in the bank. 0 turns earning off. |
| Minutes per swapped point | 3 | Kids can swap points for minutes on their board. 0 turns swapping off. Swapping doesn't lower their level. |
| Most minutes a day | 120 | The most a kid can use in one day. 0 = no limit. |
| Most minutes in the bank | 300 | Stops a kid hoarding a week of gaming. 0 = no limit. |

Parents can add or take away minutes from a kid's board (＋15, ＋30, −15), and switch the bank off for one kid in **Kids → Edit → Pages**.

Undoing a chore's approval takes back the minutes it earned. Stopping a session early puts the whole minutes left back in the bank.

## Home Assistant

Sessions send two events (see [home-assistant.md](home-assistant.md#5-events) for setting up the webhook):

| Event | Details |
| --- | --- |
| `screen_time_started` | `minutes`, `ends_at`, `session_id`, `balance` |
| `screen_time_ended` | `reason` (`time_up`, `stopped` or `parent`), `minutes`, `used`, `balance` |

The summary (`/ha/summary`) has per kid `screen_minutes`, `screen_time_on` and `screen_time_ends_at`.

### Switch the TV on and off

```yaml
automation:
  - alias: Den Duty screen time
    triggers:
      - trigger: webhook
        webhook_id: den-duty
        allowed_methods: [POST]
        local_only: true
    conditions: "{{ trigger.json.event in ['screen_time_started', 'screen_time_ended'] and trigger.json.kid == 'Ava' }}"
    actions:
      - if: "{{ trigger.json.event == 'screen_time_started' }}"
        then:
          - action: switch.turn_on
            target: { entity_id: switch.playroom_tv }
        else:
          - action: switch.turn_off
            target: { entity_id: switch.playroom_tv }
          - action: tts.speak
            target: { entity_id: tts.home_assistant_cloud }
            data:
              media_player_entity_id: media_player.playroom
              message: "Screen time is up, Ava. Great job!"
```

The same pattern works for a router's parental controls (pause a device's internet), a smart plug on a console, or Android TV / Fire TV.

### Stop a session from Home Assistant

```yaml
rest_command:
  den_duty_screen_stop:
    url: "http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/screen-time/stop"
    method: POST
    headers:
      Authorization: !secret den_duty_control
    content_type: "application/json"
    payload: '{"kid": "{{ kid }}"}'
```

It needs a control token, matches the kid by name ("ava" finds "Avaleigh"), refunds the unused minutes and answers with a `speech` line for Assist.
