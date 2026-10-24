# 0009: Budgets from chosen categories (app review round 2)

Decided by Deva on 2026-10-24.

| Decision | Choice | Why |
| --- | --- | --- |
| What a budget covers (BUD-1) | Only the categories the user gives a budget. Spending in other categories still shows as spent, on its own "outside your budgets" line, and does not reduce what is left | Not every category or entry needs a budget |
| Month total (BUD-1) | The sum of the category budgets in effect that month, including one-month overrides. The separate overall budget goes; old overall rows are removed in a migration | One number to set per category, and the total always adds up |
| Parent and sub-categories (BUD-1) | One or the other: a branch has either one parent budget, covering the parent and all its sub-categories, or budgets on its sub-categories. Setting a parent budget when children have budgets offers to replace them with their sum; setting a child budget when the parent has one offers to remove the parent's | Never counts the same rupee twice, and screens stay simple. A parent cap over child budgets can come later if it is missed |
| No budgets set | Home shows money in, spent, and in minus spent, as before | The card stays useful before any budget exists |
| Alerts (BUD-2) | Pace alerts per budgeted category, and for the month's total instead of the old overall budget | Follows the new total |
