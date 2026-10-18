# Home Assistant

Den Duty has a small API that Home Assistant reads with its built-in `rest` integration, a few actions you can call with `rest_command`, and events it can push to a Home Assistant webhook.

## 1. Create tokens

In Den Duty go to **Settings → Home → Home Assistant and automations**. Only parents can do this.

- A **read only** token is enough for sensors.
- A **read and control** token can also mark chores done, approve them, and give or take points. It still can't add kids, change chores or delete anything.

Copy each token when it's shown; it isn't shown again. Your **Home ID** is printed in the same box. Test it:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/summary
```

## 2. Add to `secrets.yaml`

```yaml
den_duty_read: "Bearer dnk_your_read_token"
den_duty_control: "Bearer dnk_your_control_token"
```

## 3. Sensors in `configuration.yaml`

`kids_by_name` is keyed by each kid's name in lower case (spaces become `_`), so templates stay short. Repeat the block per kid.

```yaml
rest:
  - resource: http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/summary
    headers:
      Authorization: !secret den_duty_read
    scan_interval: 120
    sensor:
      - name: "Chores waiting for review"
        unique_id: den_duty_waiting
        icon: mdi:clipboard-check-outline
        value_template: "{{ value_json.waiting_for_review }}"
      - name: "Ava points"
        unique_id: den_duty_ava_points
        icon: mdi:star-four-points
        unit_of_measurement: "{{ value_json.points_name }}"
        value_template: "{{ value_json.kids_by_name.ava.balance }}"
        json_attributes_path: "$.kids_by_name.ava"
        json_attributes:
          - points_this_week
          - level_name
          - next_goal
          - next_goal_percent
          - chores_left
      - name: "Ava chores left today"
        unique_id: den_duty_ava_left
        icon: mdi:broom
        value_template: "{{ value_json.kids_by_name.ava.left_today }}"
      - name: "Ava waiting for approval"
        unique_id: den_duty_ava_waiting
        icon: mdi:timer-sand
        value_template: "{{ value_json.kids_by_name.ava.waiting_for_review }}"
      - name: "Ava streak"
        unique_id: den_duty_ava_streak
        icon: mdi:fire
        unit_of_measurement: days
        value_template: "{{ value_json.kids_by_name.ava.streak }}"
      - name: "Ava level"
        unique_id: den_duty_ava_level
        icon: mdi:paw
        value_template: "{{ value_json.kids_by_name.ava.level_name }}"
```

If a parent switched a page off for a kid (Kids → Edit), that kid's sensors for it are `null`: Chores (`left_today`, `waiting_for_review`…), Goals (`next_goal`), Stats (`streak`, `level`…). `pages_off` lists what's off.

Each kid in `kids` (and `kids_by_name`) has: `balance`, `points_this_week`, `left_today`, `done_today`, `total_today`, `waiting_for_review`, `done_this_week`, `streak`, `best_streak`, `level`, `level_name`, `level_badge`, `next_goal`, `next_goal_percent`, `chores_left`.

## 4. Actions with `rest_command`

Kids and chores can be named (any case) or given by id. Chores are matched by title among that kid's chores today.

```yaml
rest_command:
  den_duty_complete:
    url: http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/complete
    method: POST
    headers:
      Authorization: !secret den_duty_control
      Content-Type: application/json
    payload: '{"kid": "{{ kid }}", "chore": "{{ chore }}"}'
  den_duty_approve:
    url: http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/approve
    method: POST
    headers:
      Authorization: !secret den_duty_control
      Content-Type: application/json
    payload: '{"kid": "{{ kid }}", "chore": "{{ chore }}"}'
  den_duty_quick_reward:
    url: http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/quick-reward
    method: POST
    headers:
      Authorization: !secret den_duty_control
      Content-Type: application/json
    payload: '{"kid": "{{ kid }}", "reward": "{{ reward }}"}'
  den_duty_penalty:
    url: http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/penalty
    method: POST
    headers:
      Authorization: !secret den_duty_control
      Content-Type: application/json
    payload: '{"kid": "{{ kid }}", "points": {{ points }}, "reason": "{{ reason }}"}'
```

- **complete** marks a chore done as if the kid tapped it. It still waits for a parent.
- **approve** approves it and pays the points.
- **quick-reward** gives one of your quick rewards by name (Settings → Rewards).
- **penalty** takes points away with a reason. Balances stop at zero unless the home allows going below.

Example: an NFC tag on the dog bowl.

```yaml
automation:
  - alias: Dog fed tag
    triggers:
      - trigger: tag
        tag_id: dog-bowl
    actions:
      - action: rest_command.den_duty_complete
        data:
          kid: Ava
          chore: Feed the dog
```

## 5. Events

Den Duty records an event when a chore is marked done (`chore_submitted`) or approved (`chore_approved`), when points are given or taken outside chores (`points_changed`), and when a goal is reached (`goal_reached`) or redeemed (`goal_redeemed`).

**Webhook (instant).** Create an automation with a webhook trigger, then paste its URL into **Settings → Home Assistant → Webhook for events**:

```yaml
automation:
  - alias: Den Duty events
    triggers:
      - trigger: webhook
        webhook_id: den-duty
        allowed_methods: [POST]
        local_only: true
    actions:
      - choose:
          - conditions: "{{ trigger.json.event == 'chore_submitted' }}"
            sequence:
              - action: notify.mobile_app_your_phone
                data:
                  title: "{{ trigger.json.kid }} finished a chore"
                  message: "{{ trigger.json.icon }} {{ trigger.json.chore }} is waiting for your OK."
          - conditions: "{{ trigger.json.event == 'goal_reached' }}"
            sequence:
              - action: tts.speak
                target:
                  entity_id: tts.home_assistant_cloud
                data:
                  media_player_entity_id: media_player.kitchen
                  message: "Woohoo! {{ trigger.json.kid }} reached {{ trigger.json.goal }}!"
```

The webhook URL is `http://homeassistant.local:8123/api/webhook/den-duty`. Every event carries `event`, `kid`, `kid_id`, `at`, plus details such as `chore`, `points`, `balance`, `goal`, `reward` and `by`.

**Polling.** `GET /api/homes/{id}/ha/events?after={last id}` returns the newest 50 events, if you'd rather poll.

## API reference

Every route accepts `Authorization: Bearer <token>`.

| Method | Path | Token | Body |
| --- | --- | --- | --- |
| GET | `/api/homes/{id}/ha/summary` | read | |
| GET | `/api/homes/{id}/ha/today` | read | |
| GET | `/api/homes/{id}/ha/events?after=0` | read | |
| POST | `/api/homes/{id}/ha/complete` | control | `{"kid": "Ava", "chore": "Feed the dog"}` or `{"instanceId": "..."}` |
| POST | `/api/homes/{id}/ha/approve` | control | same as complete |
| POST | `/api/homes/{id}/ha/quick-reward` | control | `{"kid": "Ava", "reward": "Great attitude"}` |
| POST | `/api/homes/{id}/ha/points` | control | `{"kid": "Ava", "amount": 2, "reason": "Helped unload groceries"}` |
| POST | `/api/homes/{id}/ha/penalty` | control | `{"kid": "Ava", "points": 2, "reason": "Screen time over"}` |
| GET | `/api/calendar/{token}.ics` | none (secret link) | see Settings → Calendars |
