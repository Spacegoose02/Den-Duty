# Voice: "Hey, what are my chores?"

Den Duty answers short spoken questions through **Home Assistant Assist**, so you can ask a voice satellite, the Home Assistant app, or Alexa / Google Assistant (through Home Assistant Cloud or the `alexa` / `google_assistant` integrations).

Den Duty does the talking: it returns one plain sentence that Assist reads out. Home Assistant only needs to pass the question along.

## What it can answer

| Ask | Answer |
| --- | --- |
| What are Ava's chores? | "Ava has 3 chores left: Dishes, Trash and Feed the cat." |
| What's next for Ava? | "Next up for Ava: Dishes, by 07:30." |
| How many points does Ava have? | "Ava has 42 Shinies, and earned 12 this week." |
| How close is Ava to her goal? | "Ava needs 8 more Shinies for Ice cream trip." |
| What's Ava's streak? | "Ava is on a 5 day streak. The best is 9." |
| How's Ava's practice going? | "Reading: 3 of 5 days, done today. Piano: 1 of 3 days." |
| Who still has chores? | "Ava has 2 chores left. Ben is all done." |
| Ava finished the dishes | "Nice work! Dishes is waiting for a grown-up. 2 chores to go." |

Names match loosely ("Ava" finds "Avaleigh"), and so do chores ("the dishes" finds "🍽️ Dishes").

## 1. Tokens

Make two tokens in **Settings → Home Assistant and automations** (see [home-assistant.md](home-assistant.md)): a read token for questions and a control token for "I finished…". Put them in `secrets.yaml`:

```yaml
den_duty_read: "Bearer dnk_your_read_token"
den_duty_control: "Bearer dnk_your_control_token"
```

## 2. `configuration.yaml`

```yaml
rest_command:
  den_duty_say:
    url: "http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/say?kid={{ kid | default('') | urlencode }}&about={{ about }}"
    method: GET
    headers:
      Authorization: !secret den_duty_read
  den_duty_done:
    url: "http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/say/done"
    method: POST
    headers:
      Authorization: !secret den_duty_control
    content_type: "application/json"
    payload: '{"kid": "{{ kid }}", "chore": "{{ chore }}"}'

intent_script:
  DenDutyAsk:
    action:
      - action: rest_command.den_duty_say
        data:
          kid: "{{ kid | default('') }}"
          about: "{{ about | default('chores') }}"
        response_variable: result
      - stop: ""
        response_variable: result
    speech:
      text: "{{ action_response.content.speech }}"
  DenDutyDone:
    action:
      - action: rest_command.den_duty_done
        data:
          kid: "{{ kid }}"
          chore: "{{ chore }}"
        response_variable: result
      - stop: ""
        response_variable: result
    speech:
      text: "{{ action_response.content.speech }}"
```

## 3. Sentences: `config/custom_sentences/en/den_duty.yaml`

Replace the names with your kids' names.

```yaml
language: "en"
intents:
  DenDutyAsk:
    data:
      - sentences:
          - "what (are|is) {kid}['s] chores"
          - "what does {kid} (have|need) to do [today]"
          - "how many chores (does|has) {kid} [got] left"
        slots:
          about: "chores"
      - sentences:
          - "what's next for {kid}"
          - "what should {kid} do next"
        slots:
          about: "next"
      - sentences:
          - "how many (points|shinies) (does|has) {kid} [got]"
        slots:
          about: "points"
      - sentences:
          - "how close is {kid} to [(his|her|their)] goal"
        slots:
          about: "goal"
      - sentences:
          - "what's {kid}['s] streak"
        slots:
          about: "streak"
      - sentences:
          - "how's {kid}['s] practice [going]"
        slots:
          about: "practice"
      - sentences:
          - "who (still has|has) chores [left]"
          - "how are the chores going"
        slots:
          about: "everyone"
  DenDutyDone:
    data:
      - sentences:
          - "{kid} (finished|did|is done with) [the] {chore}"
          - "mark [the] {chore} done for {kid}"

lists:
  kid:
    values:
      - "Ava"
      - "Ben"
  chore:
    wildcard: true
```

Restart Home Assistant (or reload YAML), then try "What are Ava's chores?" in Assist.

## Without Home Assistant

The two endpoints work with anything that can make an HTTP request (Apple Shortcuts, Node-RED, a Stream Deck):

```bash
curl -H "Authorization: Bearer dnk_read" "http://YOUR_SERVER:8080/api/homes/YOUR_HOME_ID/ha/say?kid=Ava&about=chores"
# {"speech":"Ava has 2 chores left: Dishes and Feed the cat.","about":"chores"}
```

Topics: `chores`, `next`, `points`, `goal`, `streak`, `practice`, `everyone`.
