# Tavern Character Card Import Compatibility

[Back to README](../README.md) | [简体中文](tavern-compatibility.md)

**Status: the card-import surface (field mapping and rejection behavior) has been verified field by field; the Tavern-side behavior of card-level fields has now been evidenced against upstream source; the other compatibility surfaces are not yet evidenced.**

> **None of the known gaps has been fixed.** Of the **<<ledger.gapTotal>>** items listed under "Known Gaps" below, **not one** was implemented in ElecKoi when this document was written; `tests/character-card-fidelity-target.test.ts` is one of the **red target suites** that pin them (<<ledger.redTotal>> red across the three target files, skipped by default; <<ledger.cardRed>> of them live in this file, <<ledger.companionRed>> in `-context.test.js` and <<ledger.worldRed>> on the world-book surface). In other words, this document records **the current state of the gap**, not "we are compatible". See the closing subsection of "Known Gaps" for the running count.

## What This Document Answers

When a Tavern (SillyTavern) character card is imported into ElecKoi, what happens to each field in the card: **whether it is read, where it lands, what is not read, and why**.

It does **not** answer whether the resulting roleplay "feels like Tavern", whether world-book injection into the model is the same, or whether presets / export / variable runtime / frontend cards are compatible — those surfaces are covered by "Out of Scope for This Document" at the end.

Keeping "the field is read" separate from "the behavior after import is the same" is the first discipline of this document: **reading a field does not mean the two sides behave alike**.

## Summary of Conclusions

- The field manifest covers **<<card.total>> items** (fields defined by the card specification, key names used by Tavern's own world-book files, and the V2 top-level mirrors and TavernHelper script-envelope fields found in real-card corpora), of which **<<card.mapped>>** are read and land in ElecKoi's data structures (<<card.mappedPercent>>%).
- A denominator closer to "how compatible is it": among the fields Tavern actually reads it is **<<card.mapped>> / <<card.stReadable>> = <<card.stReadablePercent>>%** (the denominator excludes <<card.neitherSideReads>> declared "neither side reads it" rows). Both are manifest-based figures and do not represent the distribution of real card libraries.
- Weighting the fields that appear in the fixtures by how many times they appear gives **<<contact.percent>>%** (<<contact.mapped>> / <<contact.total>>). This is a fixture-based figure, used only to observe a trend; it does not represent the distribution of real card libraries.
- **Normal V2 / V3 cards can all be imported**; they do not fail merely because "there is a field the importer does not recognize". Only two kinds fail: flat V1-only cards, and the four carriers that are not accepted.
- A world-book entry's **content, constant flag, and enabled state** all come across; its **keywords are silently cleared in three cases** (constant entry, EJS controller, referenced by `getwi`), its **secondary-key condition** comes across only when the entry is not constant, and its **trigger scheduling** (probability / grouping / depth / recursion / delay) does not. See "Entries That Are Rewritten on Import".
- **The standalone world book a card points at (`extensions.world`) does not come along**: Tavern attaches that world book to the card while loading it (`<<cite.characters.worldBook>>` reads the file and turns it into `data.character_book`), and ElecKoi does not read this field. Today, importing "card + external world book" leaves the world book empty.
- Three places will trip you up if they are not stated clearly: the **default values** of `enabled` and `selective`, and the fact that **MVU variable-update scripts are not executed at all**.

## How to Read the Tables Below

| Result | Meaning |
| --- | --- |
| **Mapped** | ElecKoi reads this field and stores it at the location given in the table |
| **Not read** | ElecKoi does not read it; see "Known Gaps" |
| **Semantics differ** | It is read, but behaves differently from Tavern; see "Fields That May Behave Differently" |
| **Neither side reads it** | Tavern's card-import path does not read it either, so it is not a compatibility gap |

Evidence boundary: the **Tavern side** has two evidence surfaces. (1) **In-card world-book import and triggering** is referenced against [SillyTavern](https://github.com/SillyTavern/SillyTavern)'s `<<path.wi.sourceFile>>` (<<card.citedWorldBook>> rows). (2) **Card-level fields on their way from card to prompt** are referenced against `public/script.js`, `public/scripts/openai.js`, `public/scripts/PromptManager.js`, and `src/endpoints/characters.js` (see "Tavern-Side Behavior of Card-Level Fields" below). For the card specification, the [Character Card V3 specification](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md) is the reference. Reference version: SillyTavern **v1.19.0** (`06bde939`, 2026-09-14).
**Card-level fields that are not yet independently evidenced** (`creator_notes` / `creator` / `character_version` / `tags` / `nickname` / `assets` / `depth_prompt`, and so on) still reuse the identifiers from the existing defect list and make no independent conclusions — they have no separate Tavern-side explanation in the Known Gaps table.

The `P0-x` / `P1-x` / `P2-x` in parentheses are identifiers from the existing compatibility defect list, and are also the values of `tracking` in the field manifest: `P0` affects core behavior, `P1` affects something obvious but has an alternative path, and `P2` is metadata and peripheral capability.

**<<card.citedRows>> rows** of the <<card.total>> in the field manifest carry an upstream line number plus a one-line excerpt — **<<card.citedWorldBook>> rows** are world-book rows (`world-info.js`) and **<<card.citedCardLevel>> rows** are card-level fields (the five P0-2 rows plus `extensions.world`; upstream `script.js` / `characters.js` and friends). The other **<<card.uncited>> rows** have only an ElecKoi-side destination or an audit identifier and **no** independent Tavern-side citation. **Line numbers drift with upstream versions; the excerpt is what is used to relocate them.**

## The Path an Import Follows

ElecKoi accepts only two carriers, and there is only one decoding entry point **for character cards**:

> **There is a second import entry point, and it is not the function this document tests.** The setting-library panel's import button (`parseSillyTavernExport`, `<<path.eleckoi.settingLibraryTransfer>>`) also accepts the same **JSON containing `data.character_book`**. The two paths' entry mapping is **character-for-character identical** (`<<cite.eleckoi.settingLibraryTransfer>>` ↔ `<<cite.eleckoi.cardFormats>>`), but the renderer path **does not do the MVU filtering** (infrastructure entries such as `[initvar]` / `[mvu_update]` are imported as ordinary setting entries) and **does not import the variable configuration**. The <<card.total>>-item manifest in this document **describes the character-card decoding path only**.

- **PNG**: read the `tEXt` text chunks and look for the two keywords `ccv3` and `chara` in that order (the content is base64-encoded JSON).
- **JSON**: text that begins with `{`.

After decoding, a card is split into three pieces of data: the **setting library** (character description, opening messages, world-book entries), the **variable configuration** (MVU), and **regex rules**; the card name and the opening messages additionally land on fields of the character itself.

Import synthesizes several entries; these are **not** fields from the card, but ElecKoi's own structures:

- the "Character Description"（角色描述）entry ← `description`
- the "AI Character Opening Messages"（AI角色开场白）entry ← `first_mes` and `alternate_greetings` (deduplicated by content; the first one is the default opening)
- a group named after `character_book.name` (default title "Tavern World Book"（酒馆世界书）), under which all world-book entries hang

### Cards That Are Rejected

> The messages below are quoted verbatim from the application, which currently emits them in Chinese; the English in parentheses is a translation.

| Carrier / Form | Result |
| --- | --- |
| `.charx` (zip container) | Rejected: "Tavern character cards must be PNG or JSON files"（酒馆角色卡必须是 PNG 或 JSON 文件） |
| `.webp` (RIFF container) | Same as above |
| Text that does not begin with `{` (including malformed JSON) | Same as above |
| PNG with only an `iTXt` text chunk | Rejected: "The image contains no Tavern character card data"（图片里没有酒馆角色卡数据） |
| **A flat V1-only card** (top level is `name` / `first_mes` directly, with no `data` wrapper) | Rejected: "The Tavern character card is missing character data"（酒馆角色卡缺少角色数据） |

> If a PNG contains both a `ccv3` and a `chara` text chunk, ElecKoi prefers `ccv3`; when `ccv3` is corrupt it does **not** fall back to `chara`, and the import fails.

## Field Compatibility Table

> The tables below are a **view** of the field manifest (`tests/helpers/tavernCardFieldManifest.ts`): the manifest is the single source of truth — keep this page in sync when you change it.

#### Card-Level Fields

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `name` | `packageData.character.name` |
| `description` | `settingLibrary.entries[title=角色描述].content` |
| `first_mes` | `settingLibrary.entries[title=AI角色开场白].openingMessages[].content` |
| `alternate_greetings` | `settingLibrary.entries[title=AI角色开场白].openingMessages[]` |
| `character_book` | `settingLibrary.entries[groupId=tavern-world-book]` |

#### In-Card World Book · Book Level

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `character_book.name` | `settingLibrary.name` |

#### In-Card World Book · Entry Fields

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `entries[].key` | `settingLibrary.entries[].keywords` |
| `entries[].keysecondary` | `settingLibrary.entries[].conditionKeywords` |
| `entries[].comment` | `settingLibrary.entries[].title` |
| `entries[].content` | `settingLibrary.entries[].content` |
| `entries[].constant` | `settingLibrary.entries[].agentReadStrategy` |

`key` / `keysecondary` are the primary key names used in Tavern's own world-book files (the card specification calls them `keys` / `secondary_keys`); ElecKoi accepts both names.

#### In-Card Regex Scripts

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `extensions.regex_scripts` | `regexRules` |
| `extensions.regex_scripts[].scriptName` | `regexRules[].name` |
| `extensions.regex_scripts[].findRegex` | `regexRules[].pattern` |
| `extensions.regex_scripts[].replaceString` | `regexRules[].replacement` |
| `extensions.regex_scripts[].placement` | `regexRules[].targets` |
| `extensions.regex_scripts[].disabled` | `regexRules[].enabled` |
| `extensions.regex_scripts[].markdownOnly` | `regexRules[].displayOnly` |
| `extensions.regex_scripts[].promptOnly` | `regexRules[].promptOnly` |
| `extensions.regex_scripts[].runOnEdit` | `regexRules[].runOnEdit` |

A rule whose regular expression is itself invalid is **dropped as a whole**, and the remaining rules are imported as usual.

#### MVU Variable Surface

| 酒馆卡字段 | 电子爱落点 |
| --- | --- |
| `extensions.tavern_helper` | `variableConfig` |
| `extensions.tavern_helper.variables` | `variableConfig.initialStateJson` |
| `extensions.tavern_helper.scripts` | `variableConfig.variables` |
| `extensions.tavern_helper.scripts[].content` | `variableConfig.schemaCode` |
| `extensions.tavern_helper.scripts[].enabled` | `variableConfig.variables` |

The whole variable table is read in; scripts are used only to **derive the variable structure** (by parsing the Zod schema inside them), and the scripts themselves are not executed. MVU infrastructure entries such as `[initvar]` and `[mvu_update]` do not become setting-library entries.

#### Entry `extensions.*`: Keys Not Read (by Severity)

| Severity | Count | Keys |
| --- | --- | --- |
| P0-4 | <<ext.p0_4>> | `depth`、`position`、`role`、`display_index`、`outlet_name` |
| P0-5 | <<ext.p0_5>> | `probability`、`useProbability`、`group`、`group_override`、`group_weight`、`sticky`、`cooldown`、`delay`、`use_group_scoring`、`automation_id`、`vectorized`、`triggers`、`ignore_budget`、`exclude_recursion`、`prevent_recursion`、`delay_until_recursion`、`match_persona_description`、`match_character_description`、`match_character_personality`、`match_character_depth_prompt`、`match_scenario`、`match_creator_notes` |
| issue-3 | <<ext.issue_3>> | `scan_depth` |

## Entries That Are Rewritten on Import

A field can be read and the entry can still be rewritten. The cases below are all **silent rewrites**: the import does not fail, and the interface gives no notice.

| Case | ElecKoi's behavior | Consequence |
| --- | --- | --- |
| The entry is constant (`constant: true`) | Clears `keywords` and `conditionKeywords`, and sets the condition to `none` | Keywords are not kept. Tavern keeps them (`<<cite.wi.constantKey>>` stores `key` unconditionally); if the constant flag is turned off later in the interface, the keywords cannot be restored |
| The entry is an EJS controller (content contains `<%`) | Clears the keywords; `enabled` still follows the card | Keywords are not kept |
| The entry is pointed at by a literal `getwi(...)` (an EJS reference) | Clears the keywords and **forces the entry enabled** | An entry the card explicitly marked `enabled: false` is turned on, with no notice |
| A controller uses a non-literal `getwi` (for example `getwi(x)`) | **Every non-controller entry** in the world book is treated as an EJS reference | The whole world book loses its keywords and every disabled state is overridden |
| An entry's key is written in the `/…/flags` form (which is exactly how Tavern's own exported world books look) | The keyword is stored in `keywords` verbatim but is **not run as a regex**: the card has no `use_regex` key, and ElecKoi parses `/…/` only when `use_regex: true` is explicit | That keyword **silently never matches**. Tavern needs no switch — it detects the regex from the key name (`world-info.js:337-341`). The fixture `v3-worldbook-regex-key.json` pins this shape |

Two milder rewrites also apply: when several entries share a name, the title gets a numeric suffix; `alternate_greetings` are deduplicated by text, so duplicate alternate greetings collapse into one.

EJS is an extension that ElecKoi recognizes itself, not a Tavern core concept, so the third and fourth rows are not "differs from Tavern" but "import rewrites the entry". Among the cases above, "a constant entry loses its keywords" and "a `/…/flags` key does not take effect (faithful on import, dead at runtime)" are asserted by fixtures; the two EJS rows currently have **probe evidence only**, and pinning them needs new fixtures and manifest decisions.

## Fields That May Behave Differently (<<card.semanticsRows>>)

ElecKoi reads all <<card.semanticsRows>> of these fields, but the two sides do not behave in exactly the same way. **The first <<card.deviates>> rows are the differences that genuinely deserve attention** (Tavern reads them, but with different semantics); the last <<card.stUnread>> rows are cases where "Tavern does not read this key".

| Tavern card field | ElecKoi destination | Difference from Tavern |
| --- | --- | --- |
| `entries[].keys` | `settingLibrary.entries[].keywords` | When the key is written as `/…/flags`, Tavern runs it as a regular expression (detected from the key name, with no switch); ElecKoi treats it as a regex only when the entry explicitly carries `use_regex`, and cards exported by Tavern have no such key — so the keyword is compared **literally** and never matches. |
| `entries[].enabled` | `settingLibrary.entries[].enabled` | When an entry **does not specify `enabled`**: Tavern imports it as **disabled**, ElecKoi imports it as **enabled**. The default points in the opposite direction. |
| `entries[].secondary_keys` | `settingLibrary.entries[].conditionKeywords` | Tavern uses secondary keys only when the entry's `selective` is true, and in the card-import path `selective` **defaults to false**; ElecKoi does not read `selective`, so secondary keys **always apply**. For an entry that does not specify `selective`, the two sides therefore make exactly opposite decisions about whether to use secondary keys. |
| `entries[].extensions.selectiveLogic` | `settingLibrary.entries[].keywordCondition` | Tavern has four logics (`AND_ANY` any match / `NOT_ALL` any mismatch / `NOT_ANY` no match at all / `AND_ALL` all match); `NOT_ALL` and `NOT_ANY` are the negated ones. ElecKoi expresses only two of them, and a value of `NOT_ALL` is treated as "any match" — the opposite direction. The destination `keywordCondition` also has no `not_all` value, so this negated logic has nowhere to go in ElecKoi. |
| `entries[].extensions.case_sensitive` | `settingLibrary.entries[].keywordIgnoreCase` | Tavern's is **three-state**: `null` means follow the global setting; ElecKoi stores a boolean, so an intent to follow the global setting becomes an explicit off. |
| `entries[].extensions.match_whole_words` | `settingLibrary.entries[].keywordWholeWord` | Same as above. |
| `entries[].name` | `settingLibrary.entries[].title` | Tavern generates the entry title from `comment`, whereas ElecKoi prefers `name`. When a card has both, the two sides see different titles. |
| `entries[].disable` | `settingLibrary.entries[].enabled` | Tavern does not read this key (it reads only `enabled`); ElecKoi reads it when `enabled` is missing. `disable: true` disables the entry on both sides, but on different grounds. |
| `entries[].use_regex` | `settingLibrary.entries[].keywordUseRegex` | Tavern does not read this switch; it detects a regex only automatically, by whether the key name is written as `/…/flags`. When a card explicitly sets `use_regex: true`, ElecKoi treats an ordinary keyword as a regular expression and Tavern does not. |
| `entries[].case_sensitive` | `settingLibrary.entries[].keywordIgnoreCase` | ElecKoi reads this key at the top level of the entry; Tavern reads only the three-state value of the same name inside `extensions`. For a card that writes only the top-level key, ElecKoi honors it and Tavern ignores it. |
| `entries[].match_whole_words` | `settingLibrary.entries[].keywordWholeWord` | Same as above. |

## The Standalone World-Book Import Surface (a Second Importer)

ElecKoi has **two** entry points that can read the same Tavern world book, and **both read the same set of entry keys** (`keys` / `content` / `constant` / `selective`…; `scanDepth` / `probability` are flattened mirrors of the entry's `extensions.*`):

| Entry point | Input | Today's behavior |
| --- | --- | --- |
| The setting-library panel's import button | a standalone world-book export channel (top-level `entries`) | `parseSillyTavernExport` (renderer); **does not filter `[initvar]` / `[mvu_update]`** and **does not import the variable configuration** |
| Importing a character card | the card's `data.character_book` | `decodeCharacterCard` (since v0.2.7 at `packages/dsh-product-data/src/domain/characterTransfer/characterCardFormats.ts`, called from the main process); filters MVU infrastructure entries and imports the variable configuration |

These two paths are **not** what the 133-item manifest above describes — that manifest describes the card-import path only. The world-book import path gets its own denominator:

- **<<world.mapped>> / <<world.total>> = <<world.percent>>%** (`tests/helpers/tavernWorldFieldManifest.ts`: <<world.total>> rows declared under Tavern's own world-book file key names). The two denominators are **not merged**.
  ⚠️ This figure has had **<<hist.worldFixRounds>> corrections**: (1) the first version said <<hist.v1Mapped>>/<<hist.v1Total>> = <<hist.v1Percent>>%, counting rows as `mapped` on the grounds that "the key name is read but its value is dropped"; measurement showed those keys (`uid` / `selective` / top-level `selectiveLogic` / top-level `caseSensitive` / top-level `matchWholeWords` / `order` / `position` / `depth` / `role` / `displayIndex`) never appear in the importer at all, and they are now `dropped` (record: `.redgreen/58`). (2) the second version **missed three keys that really are read** — `name` / `enabled` / `use_regex` (`settingLibraryTransfer.js:311` / `:336` / `:331`) — because the fixture happened not to contain them, so the "every key in the fixture must be declared" gate could not see them; with the manifest and fixture fixed it is <<world.mapped>>/<<world.total>> = <<world.percent>>% (record: `.redgreen/60`).
- **<<world.stUnread>> of those <<world.mapped>> rows are `st-unread`** (ElecKoi reads them; Tavern's own world-book files have no such spelling): an entry's `name` (the importer takes it as the top-priority title, Tavern uses `comment`), `enabled` (the importer prefers it and falls back to `disable`, Tavern reads only `disable`) and `use_regex` (the importer treats it as the regex switch, while Tavern auto-detects regex from the `/…/flags` key form and has no such key). These are not divergences *between the two paths* but **extra aliases the importer accepts**; they are listed so that "<<world.mapped>> read" is not read as "<<world.mapped>> compatible".
- The book a card points at via `data.extensions.world` **does not come along**: Tavern reads it while loading the card and attaches it as `data.character_book` (`<<cite.characters.worldBook>>`), and ElecKoi has no such path. The target suite contains **no** red assertion for it (the reason is at the end of this section).

The two paths measurably disagree in **<<divergences.count>> places**, all pinned by `tests/tavern-world-file.test.js` (as assertions, not prose):

| # | Disagreement | Today's behavior | What fixing it does |
| --- | --- | --- | --- |
| 1 | MVU infrastructure entries | the world-book path imports `[initvar]` / `[mvu_update]` as **ordinary setting entries** (the card path filters them) and produces no variable configuration | that test case turns red |
| 2 | `selectiveLogic` | the world-book path reads only the entry's `extensions.selectiveLogic` and **not the top level**; Tavern's own on-disk shape writes the top level (`<<cite.wi.selectiveLogic>>`), so in a standard Tavern world book the secondary-key logic is ignored | same as above |
| 3 | Tavern's on-disk **camelCase** spelling `caseSensitive` / `matchWholeWords` | the importer reads the **snake_case** `case_sensitive` / `match_whole_words` (top-level or under `extensions.*`), so in a standard Tavern world book both switches are ignored | same as above |
| 4 | `position` / `depth` / `role` / `displayIndex` / `order` | these <<divergences.hardcodedKeys>> keys are **never read at all**; their destinations are hardcoded (`insert_point_1` / `1` / `user` / array index) | same as above |
| 5 | An entry with no `enabled` | the two paths **agree** (both land enabled) — this one is a control, showing the disagreement is not "the two paths differ everywhere" | turns red if they ever diverge |

#4 has the same cause as on the card path (the domain model has no field to carry these parameters); #1 / #2 / #3 are "Tavern's spelling does not match the spelling the importer reads", which is the world-book path's own problem.

Separately, "card + standalone world book" (`extensions.world`) has **no entry point at all** today: the target suite contains **no** red assertion for it (a first attempt did, but its criterion required the importer to conjure a world book off disk, which can never pass — it was withdrawn), and it is instead a whole-surface blank witness, `face:world-book-source`.

## Known Gaps

Summarized by severity. See "How to Read the Tables Below" above for what the identifiers mean.

| Severity | Count | Fields |
| --- | --- | --- |
| P0-1 | <<gap.p0_1>> | `spec`、`spec_version` |
| P0-2 | <<gap.p0_2>> | `personality`、`scenario`、`mes_example`、`system_prompt`、`post_history_instructions` |
| P0-3 | <<gap.p0_3>> | `entries[].selective` |
| P0-4 | <<gap.p0_4>> | `entries[].insertion_order`、`entries[].position`、`entries[].extensions.depth`、`entries[].extensions.position`、`entries[].extensions.role`、`entries[].extensions.display_index`、`entries[].extensions.outlet_name` |
| P0-5 | <<gap.p0_5>> | `entries[].extensions.probability`、`entries[].extensions.useProbability`、`entries[].extensions.group`、`entries[].extensions.group_override`、`entries[].extensions.group_weight`、`entries[].extensions.sticky`、`entries[].extensions.cooldown`、`entries[].extensions.delay`、`entries[].extensions.use_group_scoring`、`entries[].extensions.automation_id`、`entries[].extensions.vectorized`、`entries[].extensions.triggers`、`entries[].extensions.ignore_budget`、`entries[].extensions.exclude_recursion`、`entries[].extensions.prevent_recursion`、`entries[].extensions.delay_until_recursion`、`entries[].extensions.match_persona_description`、`entries[].extensions.match_character_description`、`entries[].extensions.match_character_personality`、`entries[].extensions.match_character_depth_prompt`、`entries[].extensions.match_scenario`、`entries[].extensions.match_creator_notes` |
| P0-6 | <<gap.p0_6>> | `extensions.tavern_helper.scripts[].name` |
| P1-1 | <<gap.p1_1>> | `extensions.world` |
| P1-3 | <<gap.p1_3>> | `extensions.regex_scripts[].minDepth`、`extensions.regex_scripts[].maxDepth`、`extensions.regex_scripts[].id`、`extensions.regex_scripts[].trimStrings`、`extensions.regex_scripts[].substituteRegex` |
| P1-8 | <<gap.p1_8>> | `nickname`、`group_only_greetings`、`assets[].type`、`assets[].uri`、`entries[].id` |
| P2-6 | <<gap.p2_6>> | `creator_notes`、`creator`、`character_version`、`tags`、`extensions.depth_prompt.depth`、`extensions.depth_prompt.prompt`、`extensions.depth_prompt.role`、`extensions.talkativeness`、`extensions.fav` |
| issue-3 | <<gap.issue_3>> | `entries[].extensions.scan_depth` |
| Neither side reads it | <<gap.unused>> | `$top.name`、`$top.description`、`$top.personality`、`$top.scenario`、`$top.first_mes`、`$top.mes_example`、`$top.tags`、`$top.avatar`、`avatar`、`$top.creatorcomment`、`$top.create_date`、`$top.talkativeness`、`$top.fav`、`extensions.tavern_helper.scripts[].id`、`extensions.tavern_helper.scripts[].info`、`extensions.tavern_helper.scripts[].type`、`extensions.tavern_helper.scripts[].button.buttons`、`extensions.tavern_helper.scripts[].button.enabled`、`extensions.tavern_helper.scripts[].button.buttons[].name`、`extensions.tavern_helper.scripts[].button.buttons[].visible`、`extensions.tavern_helper.scripts[].export_with.button`、`extensions.tavern_helper.scripts[].export_with.data`、`character_book.description`、`character_book.scan_depth`、`character_book.token_budget`、`character_book.recursive_scanning`、`character_book.extensions`、`entries[].priority`、`entries[].character_filter`、`entries[].character_filter.isExclude`、`entries[].character_filter.names`、`entries[].character_filter.tags` |
| Unsupported carrier | <<gap.unsupported>> | `$root.name`、`$root.description`、`$root.personality`、`$root.scenario`、`$root.first_mes`、`$root.mes_example` |

What each group means:

- **P0-1**: `spec` / `spec_version` are not read (decoding requires only that `data` exists), so the version marker is lost; a V1-only card falls under "unsupported carrier" as a whole.
- **P0-2**: personality, scenario, example dialogue, system prompt, and post-history instructions — **ElecKoi reads none of the five** and discards them all. This is the single largest source of behavioral difference after import, and **every real card hits it** (of <<corpus.files>> corpus files, <<corpus.importable>> were importable and <<corpus.p02Hits>>/<<corpus.p02Hits>> carried all five). The Tavern-side behavior is now independently evidenced; see "Tavern-Side Behavior of Card-Level Fields" below.
- **P0-3**: the entry's `selective` is not read; see the previous section for details.
- **P0-4**: insertion ordering — entry order, insertion position (before / after the character), depth, role, display index, and outlet name.
- **P0-5**: trigger scheduling — probability and randomness, grouping ("choose 1 of N"), delay (sticky / cooldown / delay), recursion control, vectorization, triggers, and the `match_*` family of conditions.
- **P0-6**: the manifest contains only the script name here. That scripts **are not executed at runtime** (there is no path for textual variable updates such as `_.set`) belongs to the variable-runtime surface and is out of scope for this document.
- **P1-3**: the regex depth limits and trimming parameters (`minDepth` / `maxDepth` / `id` / `trimStrings` / `substituteRegex`) are not read; a depth regex therefore applies to all messages.
- **P1-8**: nickname, group-chat-only opening messages, V3 assets (`assets`), and an entry's original `id`.
- **P2-6**: metadata — creator information, version number, tags, author's notes (`depth_prompt`), `talkativeness`, `fav` (`extensions.world` is not in this tier; see "Tavern-Side Behavior of Card-Level Fields" below).
- **P1-1**: the **standalone world book** that `extensions.world` points at is not read in. It used to be filed as P2-6 metadata, which is measurably wrong: Tavern uses it to decide which world book to load and attaches that book to the card (`<<cite.characters.worldBook>>`), so this is a **functional gap**, not a missed metadata field. See "Tavern-Side Behavior of Card-Level Fields" below.
- **issue-3**: entry-level keyword scan depth (`extensions.scan_depth`).
- **Neither side reads it**: the book-level `description` / `scan_depth` / `token_budget` / `recursive_scanning` / extension bag, plus the entry `priority` and `character_filter` family. Tavern's card-import path does not read them either, so they do not count as gaps.
- **Unsupported carrier**: the six fields of a flat V1-only card; the card as a whole is rejected, so there is no mapping to speak of.

## Tavern-Side Behavior of Card-Level Fields

The five P0-2 fields previously had only one half of their evidence — "ElecKoi does not read them". This section supplies the other half: **what Tavern does with the card once it has it**. Reference: SillyTavern **v1.19.0** (`06bde939`).

First, a fact chain that is easy to get backwards: when a V2/V3 card is loaded, Tavern **mirrors** `data.personality` / `data.scenario` / `data.mes_example` **onto the top level of the character** (`<<cite.characters.mirror>>`; `char[charField] = v2Value` at `<<cite.characters.mirrorAssign>>`), and the runtime reads **that top-level copy** (`<<cite.script.topLevelRead>>`). `system_prompt` and `post_history_instructions` are **not mirrored** and live only under `data`.

| Card-level field | How Tavern reads it | Where it lands in the prompt |
| --- | --- | --- |
| `personality` | top-level `character.personality` | run through `personality_format` (default `{{personality}}`, `<<cite.openai.personalityFormat>>`) → a **system** message at the `charPersonality` marker (`<<cite.openai.charPersonalityPosition>>`) |
| `scenario` | top-level `character.scenario`; the current chat's `chat_metadata.scenario` **wins** | run through `scenario_format` (default `{{scenario}}`, `<<cite.openai.scenarioFormat>>`) → a system message at the `scenario` marker (`<<cite.openai.scenarioPosition>>`) |
| `mes_example` | top-level `character.mes_example`; `chat_metadata.mes_example` **wins** | split on `<START>` (`<<cite.script.exampleSplit>>`) → turned into **dialogue example messages** at the `dialogueExamples` marker (`<<cite.openai.dialogueExamples>>`, **subject to the token budget**) |
| `system_prompt` | **conditional**: `chat_metadata.system_prompt` first, then `character.data.system_prompt`; used only when `prefer_character_prompt` is true (default **true**) | when non-empty, **replaces the whole content** of the `main` system prompt (`<<cite.openai.systemPrompt>>`) |
| `post_history_instructions` | **conditional**: reads only `character.data.post_history_instructions`; used only when `prefer_character_jailbreak` is true (default **true**) | when non-empty, **replaces the whole content** of `jailbreak` (post-history instructions) (`<<cite.openai.jailbreak>>`) |

Both switches default to `true` (`<<cite.powerUser.preferFlags>>` and `<<cite.settings.preferFlags>>` — two independent places, with no migration code), so for the great majority of users all five fields **do enter the prompt by default**.

Two details that are easy to get backwards: `personality` and `post_history_instructions` have **no** `chat_metadata` override, whereas `scenario` / `mes_example` do and it wins; and `system_prompt`'s `chat_metadata` override sits **inside the gate** — turn `prefer_character_prompt` off and the chat-level override stops working too.

**`extensions.world` is not metadata.** It names a **standalone world book** (a file under Tavern's own `worlds/*.json`). Tavern reads that book while loading the card and attaches it to the card (`<<cite.characters.worldBook>>`: try `originalData` first, otherwise `convertWorldInfoToCharacterBook`), so in Tavern "character card + standalone world book" is **one unit** — the single most common shape. ElecKoi does not read this field, so today that world book is empty after import. **<<corpus.worldRefLow>>-<<corpus.worldRefHigh>> of the <<corpus.importable>>** real corpus cards wrote it.

## How Far the Gaps Have Been Fixed

**Not one of them.** All **<<ledger.gapTotal>>** items listed under "Known Gaps" above are still the status quo as of this document; this document records **the gap**, not "already compatible".

The repository keeps a **red target suite** (`tests/character-card-fidelity-target.test.ts` and `-context.test.js`) that pins the quantifiable part of those <<ledger.gapTotal>> items as assertions: it currently runs **<<ledger.redTotal>> red / <<ledger.greenTotal>> green** (<<ledger.caseTotal>> cases across the three target files: <<ledger.cardRed>> red / <<ledger.cardGreen>> green here, <<ledger.companionRed>> red / <<ledger.companionGreen>> green in `-context.test.js`, <<ledger.worldRed>> red / <<ledger.worldGreen>> green in `tavern-world-file-target.test.js`). It does **not** run by default (it needs `ELECKOI_TAVERN_COMPAT_TARGET=1`), so `pnpm test` stays green — **what is green is "the status quo is recorded", not "we are compatible"**.

How to read the red count:

| Number | Meaning |
| --- | --- |
| <<ledger.redTotal>> red | each red one = one item still missing (<<ledger.redFieldLevel>> field/semantic/carrier + <<ledger.redInjectionModel>> injection model + <<ledger.redInjectionOrder>> injection-order behavior layer + <<ledger.redZeroGates>> "blank ledger must reach zero" gates + **<<ledger.worldRed>> on the world-book surface**: <<divergences.spelling>> divergences from Tavern plus <<divergences.sameCause>> where the two import paths disagree with each other). The external world book (`extensions.world`) is **not** among the <<ledger.redTotal>>: today it has no entry point at all, so it is recorded as a whole-surface blank witness (`face:world-book-source`) rather than a red assertion |
| <<ledger.greenTotal>> green | **<<ledger.blankTotal>> of them are blank witnesses** and **<<ledger.nonGapTotal>> are non-gap evidence** (these <<ledger.ungated>> are not gated by the switch): each blank witness proves "this really is blank today" and turns red the moment the feature lands |
| <<ledger.gapTotal>> = <<ledger.asserted>> + <<ledger.gapBlank>> + <<ledger.byDesign>> | <<ledger.asserted>> asserted + <<ledger.gapBlank>> with blank-witness evidence only + <<ledger.byDesign>> marked "by design" (`display_index` / `vectorized` / `automation_id`; the grounds are in the manifest) |

In other words: **all <<ledger.redTotal>> red turning green plus the two zero gates** is what equals "consistent with Tavern within the range the manifest already lists and today can express". That **still does not equal** "fully compatible with Tavern" — the credibility of the criteria is still missing one external source: the real-card corpus has had only its first round (<<corpus.files>> files), and a second person's review against upstream source has not happened yet.

## Where These Numbers Come From

- The **single source of truth** is a field manifest (`tests/helpers/tavernCardFieldManifest.ts`, **<<card.total>> items**): each gives the Tavern card field, whether it is read, its destination, its difference from Tavern, and the evidence (a `world-info.js` line number plus an excerpt, or an ElecKoi source location).
- The manifest is guarded by a set of fixtures (`tests/character-card-fidelity.test.ts` and `tests/fixtures/tavern-cards/`, **<<fixtures.count>> specification-derived fictional cards** containing no real cards):
  - every field that appears in a fixture must be declared in the manifest, or the test case fails (the manifest cannot rot);
  - if a field declared as "mapped" has no destination found in the import result, the test case fails (no regressions);
  - if the value of a field declared as "not read" appears in the import result, the test case fails (fixes are discovered, and the failure message gives the line to change directly).
- The manifest's classification went through one round of independent review (checked line by line against `world-info.js` and the decoding implementation); <<hist.auditCorrections>> value and evidence problems have been corrected.
- To reproduce (`pnpm rebuild:node` is required: this path indirectly loads the native SQLite module):

  ```bash
  pnpm rebuild:node
  npx vitest run tests/character-card-fidelity.test.ts --reporter=verbose
  pnpm rebuild:electron   # restore afterwards so dev / preview are not affected
  ```

  The test case prints the coverage report in its output: per-fixture field count, mapped count, divergence count, undeclared count, plus the two coverage figures and "rows not exercised by any fixture".
- To see how real cards behave, put the cards in a directory:

  ```bash
  ELECKOI_TAVERN_CARD_CORPUS=/path/to/cards npx vitest run tests/character-card-fidelity.test.ts
  ```

  This channel only reports a structural profile and "field paths not declared in the manifest"; it **never turns the suite red**, and it never writes cards into the repository.

## Out of Scope for This Document

The following compatibility surfaces are **not evidenced** by this document, so no conclusions are drawn about them:

- character-card **export** (whether an ElecKoi character can be turned back into a Tavern card)
- **preset** import (system prompt, jailbreak, sampling parameters, injection depth)
- **variable runtime** (textual updates such as `_.set` and `<UpdateVariable>`)
- **frontend cards** (EJS controllers and extension APIs such as `TavernHelper`) — per the positioning statement in the repository README, replicating the extension runtime is out of scope for compatibility; controllers and `getwi` references in a card are **recognized**, but the scripts are not executed
- the **world-book injection model** (Tavern injects a prompt as soon as a keyword matches; in ElecKoi, **constant / required** entries are injected the same way, but **keyword-matched** entries are left to the Agent to retrieve)
- the **first turn and startup flow**, and **macros** (other than `{{char}}` / `{{user}}`)

Every item in these surfaces needs its own evidence and criteria before it can be written into this document.
