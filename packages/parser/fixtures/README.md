# Parser fixtures

One folder per bank. Each JSON file holds cases of `{ sender, body, expect }`:

- `expect.status` is `ignored` or `failed` for messages that are not transactions.
- Otherwise `expect` lists the parsed fields to check. Amounts are integer paise.
  Fields left out are not checked.

## Anonymising a real message

Before adding a real SMS, replace every personal detail and keep the wording,
spacing and punctuation exactly as the bank wrote it:

- Account and card digits: use `1234`, `5678`, `234` (ICICI shows 3 digits).
- Names of people: `RAVI KUMAR`, `PRIYA S`.
- VPAs: `ravi@okicici`, `9876543210@ybl` style.
- References: any 12 digits, e.g. `629412345678`.
- Balances and amounts: any plausible numbers.
- Phone numbers in the bank's footer can stay; they are the bank's helplines.

`synthetic.json` files are modelled on publicly shared formats and have not yet
been checked against real messages. Add `real.json` next to them as real,
anonymised samples come in. A bank counts as supported once its `real.json`
passes.
