# 0021: Several UPI IDs for one person

Decided by Deva on 2026-11-11, in the thread "Fix duplicate people in IOUs and splits". One person often pays from several UPI apps (name@okicici, 98xxxxxx10@ybl, name@paytm). A person had room for one UPI ID, so payments from the others weren't recognised, and a second ID seen on a tagged payment was dropped. The same holds for the user: friends' phones only knew their main UPI ID.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| Shape | A person keeps one main UPI ID (`vpa`), used to pay them. Their other UPI IDs (`extra_vpas`, up to 10) are used only to recognise payments | Paying needs one target; recognising needs all of them |
| Where they live | `accounts.extra_vpas text[]` on the server, a JSON column on the phone. The user's own other IDs are in user metadata (`extra_vpas`) | Same place as the main UPI ID for each |
| Learning them | Tagging a payment to a person adds its UPI ID: as the main one if they have none, else as another ID. An ID already on someone else is left alone | No typing needed for the common case |
| Friends | Each side's other IDs travel on the friend link (`requester_extra_vpas`, `friend_extra_vpas`), kept current on every sync like name and main UPI ID. The friend writes theirs through a five-argument `respond_friend_link`; the four-argument one stays for phones without the update | Friends' phones recognise money from any of the user's apps |
| Duplicates | No two people share any UPI ID, main or other (extends decision 0020). Merging keeps every UPI ID of both | One UPI ID always means one person |

## Shipping

A database change plus JS. Run `npx supabase db push` before publishing the over-the-air update: updated phones send `extra_vpas`, which a server without the migration refuses. Phones on the old JS keep working against the migrated server.
