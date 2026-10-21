# 0001: Product decisions for the MVP

Date: 2026-10-21. Decided by Deva.

| Decision | Choice | Why |
| --- | --- | --- |
| Audience | Deva and friends, no public launch | Prove the product before taking on store review and compliance work |
| Platform | Android first; iOS follows later | iOS apps can't read SMS, and Android capture is the product's core |
| Data | Synced to Supabase (Mumbai) with row-level security; end-to-end encryption later | Enables multiple devices and IOUs shared between friends |
| Stack | React Native with Expo and TypeScript, Supabase | JavaScript preferred; one shared TypeScript core for the app and backend |
| Sign-in | Email OTP now; phone OTP later | Indian OTP SMS costs money and needs DLT registration |
| Account Aggregator | Future scope | Only regulated entities can act as FIUs |
| AI | Rules, then merchant dictionary, then Claude fallback; AI month review in the MVP | Accurate categories with little typing; the month review is a core feature |
| Costs | Free tiers only; the Anthropic API is paid with a hard monthly cap | Deva prefers no running costs |
| Banks first | ICICI, HDFC, HSBC, SBI | The banks Deva and friends use |
| Settle picker order | GPay, PhonePe, bank apps, slice | The apps Deva and friends use |
