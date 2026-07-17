# Comprehensive repository audit

- Files: **3**
- Bytes: **43,072**
- Findings: CRITICAL 0, HIGH 0, MEDIUM 7, LOW 10

## Syntax checks

- PASS `script.js` (JS)

## Findings

- **MEDIUM · html-sink** `script.js:170` — innerHTML assignment
- **MEDIUM · html-sink** `script.js:261` — innerHTML assignment
- **MEDIUM · html-sink** `script.js:379` — innerHTML assignment
- **MEDIUM · html-sink** `script.js:385` — innerHTML assignment
- **MEDIUM · html-sink** `script.js:549` — innerHTML assignment
- **MEDIUM · html-sink** `script.js:554` — innerHTML assignment
- **MEDIUM · html-sink** `script.js:565` — innerHTML assignment
- **LOW · storage** `script.js:22` — localStorage is user-controlled
- **LOW · storage** `script.js:234` — localStorage is user-controlled
- **LOW · storage** `script.js:242` — localStorage is user-controlled
- **LOW · storage** `script.js:251` — localStorage is user-controlled
- **LOW · storage** `script.js:254` — localStorage is user-controlled
- **LOW · storage** `script.js:588` — localStorage is user-controlled
- **LOW · storage** `script.js:614` — localStorage is user-controlled
- **LOW · storage** `script.js:625` — localStorage is user-controlled
- **LOW · storage** `script.js:635` — localStorage is user-controlled
- **LOW · storage** `script.js:686` — localStorage is user-controlled

## Structure

- Workflows: none
- Manifests: none
- Tests: none
- Backup-like paths: 0
- Tracked but ignored: none
- Duplicate file groups: 0


## Largest files

- `script.js` — 28,571 bytes, 820 lines
- `style.css` — 10,318 bytes, 344 lines
- `index.html` — 4,183 bytes, 76 lines

## Limitations

- Pattern matches require manual validation.
- Static audit does not exercise production networking, visual layout, or every user interaction.
