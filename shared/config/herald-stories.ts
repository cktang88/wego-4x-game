// The Herald's stories: the prose under each headline (docs/SOUL.md section 3). Pure data; the generator lives in
// shared/sim/herald.ts (storyFor). Everything is picked by hash, never by the game's RNG.
//
// Template syntax
//   {X}       a slot. A template (or bank entry) whose slots are not all known is not eligible, so fog works by
//             leaving a slot undefined: only the templates that don't need that fact can be chosen.
//   {?X}      requires slot X but prints nothing (a flag, e.g. {?murk} = the details are fogged).
//   [ ... ]   an optional part: dropped if any slot inside it is unknown. Not nested.
//
// Slots (filled in herald.ts, only when the headline's whole audience may know the fact)
//   turn, cycle ("turn" or "cycle")       A, B: the houses (roles per kind below)        R: the headline's system
//   Rx: R with its epithet ("Kessa the Unbroken")   place: where a battle was fought ("the Ashen Belt, in the Vel system")
//   home: a fleet's home world   cap: house A's capital   leader/leaderVp, trail/trailVp, throne/streak: the standings
//   Fleets: F (name), Ft (name with article: "the Dawn Patrol"), C (commander), rank ("veteran"), ep (an epithet),
//     scar (newest scar), scars ("two scars"), honours ("Field Medics and Hunters"), age ("nine turns"), routs ("twice"),
//     sigil, boon, boonDesc, vow, target (a commander to avenge), guard (a world sworn to)
//   Battles: battle (its name), lost (total), W/L (winner/loser house), Wf/Lf (their lead fleets), Wc/Lc (commanders),
//     lossW/lossL ("five ships"), nW/nL ("five"), rounds, days, first (the house that fired first), read (a posture sentence), fallen (a fleet
//     destroyed there), slain (a commander killed there), fated (a Fate spent there), murk (details fogged)
//   victim/killer/Vf (blood-debts), since (turns ago), calling, deed, tenure, taken, kindR, X (another system),
//   share/until/terms (tribute), use/useDesc/left (Fate), posture/bet (postures), words (sworn words),
//   edict/edictVp (the current edict), pledge (a house's dispatch quoted from the last edition)
//
// Roles of A and B
//   battle: A, B = the two main sides     rout/destroyed/caught/death: A = owner, B = the house that did it
//   capture/capital/liberated/razed: A = taker, B = former owner    debt: A = debtor, B = creditor
//   vengeance: A = avenger, B = the debtor who paid     tribute: A = receiver, B = payer
//   tribute_offer: A = offering, B = besieged     oath: A = oathbreaker, B = betrayed
//   refugees: A = the house they belong to, B = the cause     p_*: A = the fleet's house, B = the other side

export type Mood = 'war' | 'loss' | 'glory' | 'muster' | 'world' | 'oath' | 'blood' | 'politics' | 'fate' | 'read' | 'misread' | 'grief' | 'quiet';

export interface StoryKind {
  /** The lead story's opening paragraph (1–2 sentences). */
  lede: string[];
  /** The lead story's second paragraph: details (names, numbers). Optional. */
  detail?: string[];
  /** A secondary story: one or two sentences. */
  short: string[];
  mood: Mood;
  /** Which closing paragraphs suit the lead (standings, the Throne, rumour). */
  context?: ('standings' | 'throne' | 'rumour' | 'grim')[];
}

export const STORIES: Record<string, StoryKind> = {
  // ------------------------------------------------------------------ battles
  battle: {
    mood: 'war', context: ['standings', 'grim', 'rumour'],
    lede: [
      '{lost} ships were lost at {place} on {cycle} {turn}, and the Reach is poorer for every one of them.[ When the smoke cleared, {W} held the field.]',
      'The {battle} is over. It cost {lost} hulls[, and it was {L} that paid for most of them].',
      'At {place} the guns have finally gone quiet. {lost} ships will not be coming home[, and the field belongs to {W}].',
      'Wreckage is still tumbling through {place}, where {lost} ships died in a single {cycle}’s fighting.',
      'From {place}, our correspondents report a battle of real consequence: {lost} hulls lost[, and {W} left holding what remains].',
      'It began, as these things do, with someone being certain, and it ended with {lost} wrecks strewn across {place}.',
      'Let the record show that on {cycle} {turn} the {battle} was fought, and that {lost} ships did not survive it.',
      'Salvage crews are already circling {place}. They have {lost} reasons to be there.',
    ],
    detail: [
      '{Wf}[ under {Wc}] lost {lossW}; {Lf}[ under {Lc}] lost {lossL}.[ {first} fired first, which is most of the art.]',
      'By our count {L} lost {lossL} to {W}’s {nW}.[ {read}]',
      '[{read} ]The arithmetic was unkind to {L}: {nL} hulls gone against {nW}.',
      '[{first}’s guns spoke first and never quite stopped. ]{Lf} broke after {rounds} rounds[, and {slain} did not come home].',
      '[{fallen} is gone, its banner adrift. ]{W} lost {lossW} and calls it a victory; {L} lost {lossL} and calls it nothing at all.',
      '[{read} ]Few battles are decided so plainly. {Wc} held the line while {Lc} tried, and failed, to break it.',
      '[{fated} ]{Lc} fought for {rounds} rounds before the numbers told. {L}’s losses, {lossL}, are now part of the scenery.',
      'The fighting went on for {days} {cycle}s.[ {read}] By the end {L} had lost {lossL} and {W} {lossW}.',
      '{W} held the field; {L} held its tongue, and then its funerals.',
      'It was {W}’s day. {L} will be some time counting the cost[, and longer explaining it].',
      '[{read} ]{Lf} gave ground in the end, and {W} took it.',
      'It was a long fight, {days} {cycle}s of it[, and {W} holds what is left].',
      '[{fallen} is gone. ]{Wc} held the line while {Lc} tried, and failed, to break it.',
      '{?murk}Who fought, and how, the Herald cannot yet say. The wreckage is not talking, and neither are the admiralties.',
      '{?murk}Details are scarce; whoever fought there did so beyond the reach of honest instruments.[ {W} appears to hold the field.]',
    ],
    short: [
      '{Wf} beat {Lf} at {place}: {L} lost {lossL}, {W} {lossW}.[ {read}]',
      'The {battle} is over after {rounds} rounds. {lost} hulls are lost[, and {W} holds the field].',
      '{lost} ships died at {place}[, most of them {L}’s].[ {first} fired first.]',
      'Salvagers report {lost} fresh wrecks at {place}.[ {W} won, at a price.]',
      'At {place}, {Wc} held and {Lc} did not. {L} lost {lossL}.',
      'The {battle} is done[, and {W} holds the field]. {lost} ships will not be repaired.[ {fallen} is among the dead.]',
      'Another {lost} hulls for the scrap-merchants of {place}.[ {slain} did not come home.]',
      '{?murk}Something large was fought out at {place}. {lost} wrecks; the rest, for now, is rumour.',
    ],
  },
  rout: {
    mood: 'loss', context: ['grim', 'rumour'],
    lede: [
      '{Ft} has been routed at {R}. It is limping home[ to {home}], hull-scored and short of everything but excuses.',
      'It was not a retreat, says {A}. It was, by every other account, a rout: {Ft} broke at {R}[ under {B}’s guns] and has not stopped running.',
      '{Ft}[, under the {rank} commander {C},] lost its nerve at {R} and turned for home.',
      'There is no shame in surviving, the old captains say. {Ft} will test that proverb: routed at {R}, it is limping back[ to {home}].',
      'Whatever {Ft} expected at {R}, it was not this. It fled the field[ before {B}] in poor order.',
      '{A} has lost a battle and kept a fleet, which is the kinder half of the bargain: {Ft} was routed at {R}.',
    ],
    detail: [
      'It took a new scar in the going: {scar}. [It now carries {scars}. ]Scars, unlike medals, cannot be handed back.',
      '[{C} is said to be unhurt. ]It has now routed {routs}, and a second rout so soon could finish it.',
      '[It carries {scars}. ]A fleet that limps can be caught. Every captain in the Reach knows it, and so does {B}.',
      '{C} will want to explain. The Admiralty of {A} will want to listen, at length.',
      'Founded {age} ago[ at {home}], it had never run before. It has now.',
      '[The Herald notes the scar {scar}. ]A routed fleet cannot seize, cannot attack, and moves like a wounded thing until it is home.',
    ],
    short: [
      '{Ft} broke at {R} and is limping for {home}[, a new scar ({scar}) on its hull]. A limping fleet cannot attack, and can be caught.',
      '{A}’s {F} routed at {R}[ by {B}]. It has now routed {routs}; the Admiralty is said to be counting too.',
      'Routed at {R}, {Ft}[ under {C}] is running for {home}.[ {B} may yet catch it.]',
      'A bad day for {Ft}: broken at {R}[ by {B}], it limps away with what it has left.',
      '{Ft}[ under {C}] fled {R} in disorder.[ It carries {scars}.] Its captains call it a withdrawal.',
      'At {R}, {Ft} turned and ran.[ It took a scar for its trouble: {scar}.]',
    ],
  },
  destroyed: {
    mood: 'loss', context: ['grim', 'standings'],
    lede: [
      '{Ft} is no more. It was destroyed at {R}[ by {B}], and its banner will fly only on memorials now.',
      'The {sigil} banner of {Ft} went down at {R}. [{A} raised it {age} ago; ]it did not survive {cycle} {turn}.',
      'Of {Ft}, which sailed for {A}, nothing remains at {R} but heat and wreckage.',
      '{A} has lost {Ft} at {R}[, under {B}’s guns]. Every ship, every hand.',
      'They will light candles at {home} tonight. {Ft} was destroyed at {R}.',
      'The Herald regrets to record the end of {Ft}, lost with all its ships at {R}.',
    ],
    detail: [
      '[It was commanded by the {rank} {C}. ][It bore {honours}, honours that did not save it.]',
      '[{C}, {rank}, went down with it. ]It had been flying since {cycle} {founded}.',
      '[Its epithet, {ep}, will outlive it. ]Fleets are rebuilt. Names, rarely.',
      '[{killer} is credited with the kill. ]A blood-debt follows such things in the Reach, as surely as salvagers.',
      '[It carried {scars} already. ]The last of them was the one that mattered.',
    ],
    short: [
      '{Ft} was destroyed at {R}.[ It had flown for {age}.][ {C} commanded it.]',
      '{A} loses {Ft} at {R}[ to {B}].[ It bore {honours}.] No survivors are reported.',
      'Wreckage at {R} is all that remains of {Ft}[, which flew the {sigil} for {age}].',
      'The {sigil} banner of {Ft} goes down at {R}.[ {killer} is credited with the kill.]',
      '{Ft}[, {ep},] did not survive {R}.[ {home} will light candles tonight.]',
      'At {R}, {Ft} fought its last.[ {C}, {rank}, went with it.]',
    ],
  },
  caught: {
    mood: 'loss', context: ['grim'],
    lede: [
      'A routed fleet limps, and a limping fleet can be caught. {Ft} was caught at {R}[ by {B}] and destroyed.',
      '{Ft} was so close to home. It was hunted down at {R}[ by {B}], still trailing the damage of its last defeat.',
      'There was no escape for {Ft}. Caught limping at {R}, it died there.',
      'The hunters of {B} have their prize: {Ft}, caught at {R} on the long road home.',
    ],
    detail: [
      '[Its commander was {C}, {rank}. ]A second defeat, so soon after the first, is the one no fleet survives.',
      '[It had been flying for {age}. ]The Reach is not kind to the wounded.',
      '[It carried {scars}. ]Its banner will hang at {home}, if {A} still has a wall to hang it on.',
    ],
    short: [
      'HUNTED: {Ft} caught limping at {R} and destroyed[ by {B}].',
      'No way home for {Ft}: caught at {R}.[ {C} is lost.]',
      '{B} runs down {A}’s wounded {F} at {R}.',
      '{Ft} was limping for {home}. It got as far as {R}.',
    ],
  },
  death: {
    mood: 'loss', context: ['grim'],
    lede: [
      '{C} is dead. The commander of {Ft} fell at {R}, and {A} has lost more than a fleet.',
      'They say {C} never once asked for a safer posting. The commander fell with {Ft} at {R}.',
      'At {R}, {C} commanded {Ft} to the end, and the end came.',
      '{A} has lost {C}, {rank}, at {R}. The flags at {home} will fly at half-mast.',
      'The commander {C}, of {A}, is dead at {R}. The Reach is shorter of good officers than it is of ships.',
    ],
    detail: [
      '[{killer} is credited with the blow. ]Commanders are harder to replace than hulls.',
      'Officers who served under {C} describe a hard, fair, sleepless sort of captain. The Reach has fewer of those than it needs.',
      '[{C} had risen to be counted {rank}. ]Promotion, in the Reach, is a dangerous thing to earn.',
    ],
    short: [
      '{C} falls with {Ft} at {R}.[ {A} mourns.]',
      'Death of a commander: {C}, lost at {R}.',
      '{C} of {A} is dead at {R}. The name goes on the memorial.',
      '{Ft}’s commander {C} did not survive {R}.',
    ],
  },
  broken: {
    mood: 'grief', context: ['grim'],
    lede: [
      '{Ft} has been broken, not by an enemy but by its own scars. {A} has furled the banner with honours.',
      'Three scars is one too many. {Ft} is disbanded with honours; its crews go home to {home}.',
      'Somewhere a quartermaster is filling in a form marked “Disbanded, with honours”. The form concerns {Ft}.',
    ],
    detail: [
      '[It bore {scars} at the end. ]Its ships will be divided among other banners; its name will not.',
      '[It routed {routs} in its life. ]Some fleets die in battle. Others simply run out of courage to spend.',
    ],
    short: [
      '{Ft} breaks under its third scar and is disbanded with honours.',
      '{A} furls the banner of {Ft}. Its crews go home[ to {home}].',
      'Too many scars: {Ft} is no more, though no one sank it.',
    ],
  },
  retired: {
    mood: 'glory', context: ['standings'],
    lede: [
      '{Ft} has come home. The fleet retires with honours to {R}, which will be known hereafter as its Haven.',
      'There were no guns at {R} on {cycle} {turn}, only bunting. {Ft} has furled its banner there for good.',
      'Not every legend ends in fire. {Ft}[, {ep},] retires to {R} with honours.',
    ],
    detail: [
      '[{C}, {rank}, will not be returning to the line. ]The Haven of {F} will carry its memory, and something of its skill.',
      'It flew for {age}. Few banners in the Reach can say as much, and fewer still can say it while alive.',
    ],
    short: [
      '{Ft} retires with honours to {R}.[ {C} hangs up the braid.]',
      'The banner of {Ft} comes home to {R}, which becomes its Haven.',
      '{R} is now the Haven of {F}.[ It flew for {age}.]',
    ],
  },
  // ------------------------------------------------------------------ vows, honours, legends
  vow_sworn: {
    mood: 'oath', context: ['rumour'],
    lede: [
      '{Ft} has sworn a vow, and a vow in the Reach is a public thing: {vow}.',
      'Before witnesses and the {sigil} banner, {Ft}[ under {C}] has bound itself: {vow}.',
      'Vows are cheap at a dinner table and very expensive anywhere else. {Ft} has sworn one: {vow}.',
      '{A} lets it be known that {Ft} has taken a vow: {vow}. The Herald will be keeping score.',
      'The crews of {Ft} have taken an oath, and painted it on their hulls: {vow}.',
      'Some fleets fight for pay, some for a house. {Ft} now fights for a promise: {vow}.',
    ],
    detail: [
      '[{target} has been named. ]A vow kept earns an epithet. A vow broken earns another, less pleasant one.',
      '[It has sworn to hold {guard}. ]Vows are a kind of posture, too: they tell the world exactly where you will be.',
      '[{C} is {rank}, and should know better. ]Oathbreaker is a word that sticks to a hull longer than paint.',
      'The Herald wishes it well, and has set aside a column for either outcome.',
    ],
    short: [
      '{Ft} swears: {vow}.[ {target}, take note.] A vow kept earns a name; a vow broken, a brand.',
      'A vow on the banner of {Ft}: {vow}.[ {C} seems to mean it.]',
      '{A}’s {F} takes an oath: {vow}. The Herald has reserved a column for either outcome.',
      'New vow from {Ft}: {vow}.[ It will hold {guard} or be Oathbreaker.]',
      '{Ft}[ under {C}] binds itself to a vow: {vow}. Vows tell the world exactly where you will be.',
      'Sworn aboard {Ft}: {vow}. The Herald will remember, whether or not {A} does.',
    ],
  },
  vow_kept: {
    mood: 'glory', context: ['standings'],
    lede: [
      '{Ft} swore a vow and kept it, which is rarer in the Reach than it ought to be. It will be called {ep} from now on.',
      'A promise made, a promise kept. {Ft} has fulfilled its vow and earned a name: {ep}.',
      'There are few things the Herald enjoys printing more than a vow kept. {Ft}[, under {C},] is now {ep}.',
      'Let it be written on the hull: {Ft}, {ep}. It said what it would do, and it did it.',
      'At {home} they are already painting the new name. {Ft} has kept its vow and is now {ep}.',
      '{A} has a fleet with a name worth fearing: {Ft}, {ep}, its vow fulfilled.',
    ],
    detail: [
      '[{C}, {rank}, accepted the honour without visible emotion. ]The crews were less restrained.',
      '[It flies the {sigil}, and now an epithet beneath it. ]A name like that is worth a ship or two in any battle.',
      'Rivals will note that the name came at a price, paid in full by someone else.',
    ],
    short: [
      'A vow fulfilled: {Ft} is now {ep}.[ {C} accepted the name without visible emotion.]',
      '{Ft} keeps its word and takes a name: {ep}. Promises are rarer than ships in the Reach.',
      'Promise kept. {A}’s {F} will be known as {ep}[, under {C}].',
      '{Ft}[ under {C}] fulfils its vow. Call it {ep}, and mean it.',
      'Vow kept, name earned: {Ft}, {ep}. Its rivals have one more name to fear.',
      'The yards of {home} are painting a new name on {Ft}: {ep}.',
    ],
  },
  vow_broken: {
    mood: 'oath', context: ['rumour'],
    lede: [
      '{Ft} swore a vow and has broken it. The word for that in the Reach is Oathbreaker, and it does not wash off.',
      'It was a fine vow, {vow}. {Ft} has forsworn it, and its banner now carries the brand.',
      'Every fleet thinks its vow will be easy to keep. {Ft} has discovered otherwise, and is now marked Oathbreaker.',
      '{A} will not enjoy reading this: {Ft} has broken its vow.',
      'A broken vow is a small thing in a ledger and a large thing in a tavern. {Ft} is Oathbreaker.',
      'Crews of other houses will spit when they pass {Ft} now. Its vow, {vow}, is broken.',
    ],
    detail: [
      '[{C} has offered no comment. ]The brand is permanent; the Herald merely reports it.',
      'Vows are sworn publicly for exactly this reason. Everyone was watching.',
      '[It flies the {sigil}. ]It will be a long time before anyone believes a promise from that banner.',
    ],
    short: [
      'OATHBREAKER: {Ft} forswears its vow[ ({vow})]. The brand will outlast the paint.',
      '{Ft} breaks its word.[ {C} has offered no comment.] The Reach remembers these things.',
      '{A}’s {F} fails its vow[, {vow},] and is marked Oathbreaker.',
      '{Ft} swore “{vow}”. It no longer does, and its banner says so.',
      'A vow broken aboard {Ft}. Crews of other houses will spit when it passes.',
      '{Ft}[ under {C}] is Oathbreaker now. Vows are sworn in public for exactly this reason.',
    ],
  },
  honour: {
    mood: 'glory', context: ['standings', 'rumour'],
    lede: [
      '{Ft} has been honoured: {boon}. [{C}, now {rank}, received the distinction without ceremony, there being a war on.]',
      'The Admiralty of {A} has seen fit to reward {Ft}. The honour is {boon}, and it was earned the hard way.',
      'Promotion has come to {C} of {Ft}, and with it an honour: {boon}.',
      'There is a new honour on the banner of {Ft}: {boon}. Its rivals would do well to read the citation.',
      'Some fleets collect wounds. {Ft} has started collecting honours, the latest being {boon}.',
      'The crew of {Ft} drank to {boon} last night. Their commander, {C}, is said to have had one glass and gone back to the charts.',
    ],
    detail: [
      'In plain terms: {boonDesc}',
      '[It now bears {honours}. ]Rivals should take that personally; it was meant that way.',
      '[{C} is now {rank}. ]Honours in the Reach are given for what a fleet has done, not for what it promised.',
      'The citation reads, in part: {boonDesc}',
    ],
    short: [
      '{Ft} is honoured with {boon}.[ {C} is now {rank}.] {boonDesc}',
      '{C} rises: {Ft} earns {boon}.[ It now bears {honours}.]',
      'A new honour for {A}’s {F}: {boon}. Rivals are advised to read the citation.',
      '{Ft} is honoured with {boon}. The citation, in plain terms: {boonDesc}',
      '{Ft}[ under {C}] is honoured with {boon}, earned the hard way.',
      'Promotion aboard {Ft}[: {C}, now {rank},] and the honour {boon}.[ Its full honours: {honours}.]',
    ],
  },
  legend: {
    mood: 'glory', context: ['standings', 'rumour'],
    lede: [
      'A legend is not declared. It is noticed. The Reach has noticed {Ft}, which will be known as {ep}.',
      '{Ft} has passed into legend. Its name is now {ep}, and its commander {C} into the songs.',
      'There are perhaps a handful of fleets in any age that become {ep}. {A} has one: {Ft}.',
    ],
    detail: [
      '[It bears {honours}. ]Every captain who faces it now will know the name before they know the odds.',
      '[It has flown for {age}. ]It will be a long time before anyone forgets it.',
    ],
    short: [
      'A LEGEND: {Ft} becomes {ep}.',
      '{Ft} passes into legend as {ep}.[ {C} commands.]',
      '{A} has a legend: {Ft}, {ep}.',
    ],
  },
  founded: {
    mood: 'muster', context: ['rumour'],
    lede: [
      '{A} has raised a new banner over {R}: {Ft}, under the {sigil}.',
      'A new fleet takes its oath at {R}. It is called {Ft}, and its commander is {C}.',
      'The yards of {R} have given {A} a new banner: {Ft}.',
    ],
    detail: [
      'Every fleet starts with a name and a hope. The Reach usually supplies the rest.',
      '[{C} is untried, and says so. ]Untried commanders are the only kind that become legends.',
    ],
    short: [
      '{A} raises a new banner over {R}: {Ft}.[ {C} commands.]',
      'New banner at {R}: {Ft}, under the {sigil}.',
      '{Ft} is founded at {R}[, under {C}].',
    ],
  },
  // ------------------------------------------------------------------ blood
  debt: {
    mood: 'blood', context: ['standings', 'rumour'],
    lede: [
      '{A} now owes {B} a blood-debt. The price was {victim}[, killed at {R}][ by {killer}].',
      'In the Reach, a commander’s death is never only a death. {victim} has fallen[ at {R}], and {B} has opened the ledger against {A}.',
      '{B} has sworn revenge for {victim}. The debt is written; {A} knows exactly who holds it.',
      'Blood-debts are the Reach’s oldest accounting. {A} has just acquired one: {victim}, of {B}[, killed by {killer}].',
      'There will be no forgetting {victim}. {B} has named {A} in blood-debt for the commander’s death[ at {R}].',
      'The death of {victim}[ at {R}] has a price, and {B} means to collect it from {A}.',
    ],
    detail: [
      '[{victim} commanded {Vf}. ]An avenger who settles a debt fights with something extra in the guns.',
      '[{killer} is the name {B}’s captains will be repeating. ]Debts of this kind have long memories and short tempers.',
      '[There are now {debts} open debts between the two houses. ]Neither side, it is fair to say, is in a forgiving mood.',
      'The Herald keeps no ledgers of its own, but it does keep a list. This one goes at the top.',
    ],
    short: [
      'A new blood-debt: {victim}, of {B}[, slain by {killer}]. Avengers fight harder for such debts.',
      '{B} swears revenge for {victim}[, killed at {R}].[ {Vf} went down with the commander.]',
      '{victim} is dead, and {A} is in {B}’s debt.[ There are now {debts} open debts between them.]',
      '{B} opens a ledger against {A}. The entry reads: {victim}[; the hand, {killer}].',
      'Debt of blood: {A} to {B}, for {victim}.[ {killer} is a name {B}’s captains will remember.]',
      'At {R}, {A} acquired a blood-debt it will one day be asked to pay: {victim}, of {B}.',
    ],
  },
  vengeance: {
    mood: 'blood', context: ['standings'],
    lede: [
      'The debt is paid. {A} has avenged {victim}[ at {R}], and {B} has learned that ledgers in the Reach are always balanced in the end.',
      '{since} ago {victim} fell. {A} has now settled the account[ at {R}].',
      'VENGEANCE. It is an ugly word and the Herald prints it in capitals anyway: {A} has repaid the blood-debt for {victim}.',
      'Somewhere, {victim} can rest. {A} has collected[ at {R}] what {B} owed.',
      'For {since}, {A}’s captains have spoken the name {victim} before every battle. They can stop now.',
      '{A} promised it would remember {victim}. At {R}, it proved it.',
    ],
    detail: [
      'The blood-debt is struck from the ledger. Whether a new one has been opened, the Herald will report next {cycle}.',
      'Vengeance is said to taste sweet. The crews of {A} report that it mostly tastes of smoke.',
      'It is the nature of these things that the account is closed and another opened. Watch this space.',
    ],
    short: [
      'VENGEANCE[ at {R}]: {A} has repaid {B} for {victim}. The ledger is closed.',
      '{victim} is avenged[, {since} on]. {A} has collected from {B} in the only coin that counts.',
      'The blood-debt for {victim} is settled[ at {R}]. {B} paid it; {A} will not let them forget.',
      '{A} has avenged {victim}. Whether a new debt opened in the same stroke, the Herald will report next {cycle}.',
      'Settled[ at {R}]: {A}’s debt against {B}, for {victim}.[ It took {since}.]',
      'The name {victim} can be struck from {A}’s ledger. {B} struck it, involuntarily.',
    ],
  },
  oath: {
    mood: 'oath', context: ['standings', 'rumour'],
    lede: [
      '{A} swore it. Its exact words were “{words}”. It has broken them[ at {R}], and {B} is the poorer for having believed them.',
      'OATHBREAKER. {A} has betrayed {B}[ at {R}], and the words of its oath, “{words}”, are printed here so no one forgets them.',
      'The ink was barely dry. {A} promised {B}: “{words}”. It then attacked anyway.',
      'A pact is only as good as the house that signs it. {A} has shown what its signature is worth: it fell on {B}[ at {R}].',
      'There is a word for what {A} has done to {B}, and the Herald will use it: betrayal.',
      '{B} trusted {A}. That is the whole of the story, and the Herald is sorry to tell it.',
    ],
    detail: [
      'The brand of Oathbreaker is permanent. So, one suspects, will be {B}’s memory of it.',
      'Sworn words cost nothing to say. {A} will discover, in time, what they cost to break.',
      'Other houses will draw their own conclusions about the value of {A}’s word. The Herald has drawn its own.',
    ],
    short: [
      'OATHBREAKER: {A} betrays {B} — “{words}”.',
      '{A} breaks its sworn word to {B}[ at {R}].',
      '{A} swore “{words}”. Then it attacked.',
      '{B} learns what {A}’s pact was worth.',
      'Betrayal[ at {R}]: {A} falls on {B} despite a sworn pact.',
      '“{words}”, said {A}. The Herald prints it so that nobody forgets.',
    ],
  },
  tribute_broken: {
    mood: 'oath', context: ['standings'],
    lede: [
      '{A} took {B}’s tribute for {R}, and then attacked it anyway. The Reach has a word for that, and the Herald has printed it: Oathbreaker.',
      'Peace was paid for at {R}. {A} pocketed the payment and broke the peace.',
      'It is one thing to demand tribute. It is another to take it and attack regardless. {A} has done both at {R}.',
    ],
    detail: [
      '{B} will remember. So will every house that is ever offered terms by {A} again.',
      'The terms are void, the brand is permanent, and {R} is at war again.',
    ],
    short: [
      'OATHBREAKER: {A} breaks the tribute of {R}.',
      '{A} takes {B}’s tribute, then attacks {R}.',
      'Tribute paid, peace broken: {A} falls on {R}.',
    ],
  },
  // ------------------------------------------------------------------ worlds
  capture: {
    mood: 'world', context: ['standings', 'throne', 'rumour'],
    lede: [
      '{R} has changed hands. {A} has taken it from {B}[, ending {tenure} of {B}’s rule].',
      'The flags over {Rx} are {A}’s now. {B} held it until {cycle} {turn}.',
      '{A} has taken {R} from {B}.[ It has now been taken {taken}.]',
      'There is a new governor at {R}. Its old one, appointed by {B}, is believed to be packing.',
      'Ownership of {R}, never a settled matter, has passed from {B} to {A}.',
      'The archives of {R} have a new page: taken by {A}, {cycle} {turn}.[ The previous page reads {B}.]',
      '{B} has lost {R}[, a {kindR},] to {A}.',
    ],
    detail: [
      '[Its calling as {calling} falls silent for now. ]A conquered world works for its conqueror slowly, and resents it quickly.',
      '[{B} had held it for {tenure}. ]Tenure in the Reach is measured in turns, and lost in one.',
      '[It is known as {Rx}. ]History belongs to the place; the flag is only borrowed.',
      '[Its deeds stay with it: {deed}. ]Worlds keep their memories, whoever holds the keys.',
      '[It was taken by force. ]{B} will want it back; liberation within five {cycle}s carries its own rewards.',
      'Its people will be told that nothing has changed, which will be true for about a day.',
    ],
    short: [
      '{A} takes {R} from {B}[, ending {tenure} of {B}’s rule]. A conquered world pays its new master slowly.',
      '{R} changes hands: {B} out, {A} in.[ Its calling, {calling}, falls dormant.]',
      '{B} loses {R}[, a {kindR},] to {A}. {B} has five {cycle}s to come back for it and call it liberation.',
      'New flags at {Rx}: {A}’s. The epithet stays; the governor does not.',
      '{A} plants its banner on {R}.[ The world has now been taken {taken}.][ Its deeds go with it: {deed}.]',
      'The keys of {R} pass from {B} to {A}.[ {B} had held it for {tenure}.]',
      '{R} falls to {A}.[ It was a {kindR}, and {B} will want it back.]',
    ],
  },
  capital: {
    mood: 'world', context: ['standings', 'throne'],
    lede: [
      '{R} has fallen. The capital of {B} is in {A}’s hands, and its court has fled.',
      'They said {R} could not be taken. {A} has taken it. {B}’s court is on the road with what it could carry.',
      'The seat of {B} is sacked. {A} holds {R}, and the Reach holds its breath.',
      'For a house to lose its capital is to lose the story it tells about itself. {B} has lost {R} to {A}.',
    ],
    detail: [
      '[{B} had ruled from there for {tenure}. ]The archives burned for two days, which may have been the point.',
      'Capitals change hands rarely, and never quietly. Expect {B} to say a great many things in the next edition.',
    ],
    short: [
      '{A} SACKS {R}, capital of {B}.',
      '{R} falls: {B}’s court flees.',
      'The capital of {B} is in {A}’s hands.',
      '{B} loses its seat at {R}.',
    ],
  },
  liberated: {
    mood: 'world', context: ['standings'],
    lede: [
      '{R} is liberated. {A} has returned to it[ after {since}], and its calling wakes at its old strength.',
      'They came back for {R}. {A} has liberated the world from {B}, and the bells have not stopped since.',
      '{B} held {R} briefly. {A} has taken it back, and the streets are full.',
      'A short occupation, ended: {A} has liberated {R}[ from {B}].',
      'The people of {R} have done this before and are getting good at it: their world is liberated, and {A}’s flag flies again.',
      'Liberation is the one kind of capture the Herald enjoys reporting. {A} has freed {R}.',
    ],
    detail: [
      '[Its calling, {calling}, wakes at once. ]A liberated world remembers who came back for it.',
      'It earns a deed for it: Liberated. Worlds wear such things longer than flags.',
      '[{B} will not soon forget the loss. ]Nor, one suspects, will {R}.',
    ],
    short: [
      '{R} is {A}’s again[ after {since}].[ Its calling, {calling}, wakes at its old strength.]',
      '{B} is driven from {R}[ after {since}]. {A} returns to cheers and a new deed: Liberated.',
      'Liberation at {R}: {A} is back, and its calling wakes where it left off.',
      'Bells at {R}: {A} has liberated it. {B}’s governor did not stay to hear them.',
      '{A} came back for {R}, as it promised its people it would.[ {B} held it for {since}.]',
      '{R} LIBERATED by {A}. Worlds remember who returned for them.',
    ],
  },
  razed: {
    mood: 'grief', context: ['standings', 'grim'],
    lede: [
      '{A} has burned {R}. It took what it could carry and set fire to the rest.',
      'There is no other word for it: {R} has been razed by {A}. {B} has sworn vengeance.',
      'Smoke over {R}. {A}, having taken the world, has decided it would rather have the spoils.',
    ],
    detail: [
      '{B} gains a vendetta against {A}. The Reach has learned to fear such vendettas.',
      'Razing a world is quick, profitable and permanent. Only the profit wears off.',
    ],
    short: [
      '{R} RAZED by {A}.[ {B} swears vengeance.]',
      '{A} burns {R} and takes the spoils.',
      'Ashes at {R}: {A} has razed it.',
    ],
  },
  deed: {
    mood: 'world', context: ['rumour'],
    lede: [
      '{R} has earned a deed: {deed}. Worlds keep such things long after the flags change.',
      'The chroniclers of {R} have a new line to carve: {deed}.',
      'History settles where it pleases. At {R}, it has settled as {deed}.',
    ],
    detail: [
      'A deed stays with a world through every change of hands. Only engraving makes it permanent.',
    ],
    short: [
      '{R} earns a deed: {deed}. Deeds stay with a world through every change of hands.',
      'New in the chronicle of {R}: {deed}. Only engraving will make it permanent.',
      '{deed}: {R} has earned it, and will wear it longer than any flag.',
    ],
  },
  calling: {
    mood: 'quiet', context: ['rumour'],
    lede: [
      '{R} has found its calling: {calling}. Its people seem relieved to have been told.',
      'After long debate, {R} becomes a {calling}.',
    ],
    short: [
      '{R} finds its calling: {calling}. It will grow into it, if its owner holds it long enough.',
      '{R} becomes a {calling}. Tenure will do the rest.',
      'A calling for {R}: {calling}. Worlds, like people, prefer to be useful.',
    ],
  },
  refugees: {
    mood: 'grief', context: ['grim'],
    lede: [
      'The roads out of {R} are full. Refugees of {A} are fleeing[ the fighting brought by {B}] for {X}.',
      'They left {R} with what they could carry. A ship of refugees has reached {X}, and {A} has given them a world to stand on.',
      'War is reported in hulls and flags. At {R} it is also reported in families: refugees have fled for {X}.',
      'Every siege has a second story, and it is this one: people of {R} have fled to {X}.',
      'At {X} the docks are crowded with the people of {R}, who have nowhere else to go.',
      'Refugees from {R} have reached {X}[, where they are settling at {Xb}].',
    ],
    detail: [
      '[The cause, they say, is {B}. ]What a world loses in people, another gains; but nobody calls it a fair trade.',
      'Dockworkers at {X} report crowded holds and quiet children.',
      'The Herald does not usually print the price of bread. It has risen at {X}.',
    ],
    short: [
      'Refugees flee {R} for {X}.[ They blame {B}.] The holds are crowded and the children quiet.',
      'The roads out of {R} fill: refugees reach {X}[ and settle at {Xb}]. What one world loses, another gains.',
      'People of {R} resettle at {X}[ ({Xb})]. Nobody calls it a fair trade.',
      'Refugee ships from {R} arrive at {X}. The price of bread there has already risen.',
      'Flight from {R}: {A}’s people find a haven at {X}[, away from {B}’s guns].',
      'At {X}, new arrivals from {R}, with the look of people who did not choose to come.',
    ],
  },
  refugees_lost: {
    mood: 'grief', context: ['grim'],
    lede: [
      'Refugees have fled {R}, and there is nowhere for them to go. No world of {A} has room.',
      'The ships that left {R} are still out there in the dark, looking for a world with room. {A} has none to give.',
      'There is a particular silence to a refugee ship that has been turned away. {R}’s people know it now.',
    ],
    detail: [
      '[The war that drove them out was {B}’s. ]The Herald has asked {A} what will become of them. It has not had an answer.',
    ],
    short: [
      'Refugees flee {R} into the dark.',
      'No haven for the refugees of {R}.',
      'The people of {R} flee, and {A} has nowhere to put them.',
    ],
  },
  tribute: {
    mood: 'politics', context: ['standings', 'rumour'],
    lede: [
      '{B} has paid for peace at {R}. {A} will take {share} of the system’s output until {cycle} {until}, and the guns stay cold.',
      'Peace has a price at {R}, and {B} has agreed to it: {share} of everything, to {A}, for {terms} {cycle}s.',
      'There will be no battle at {R}. There will instead be a ledger, and {B} will be paying into it: tribute to {A}.',
      'Some will call it cowardice and some will call it accounting. {B} has bought off {A} at {R}.',
      '{A} came to {R} with guns and leaves with an invoice. {B} pays tribute until {cycle} {until}.',
      'The siege at {R} is over without a shot. {B} pays {A} {share} of the yield; the terms run until {cycle} {until}.',
    ],
    detail: [
      'While the terms hold, the two houses will not fight there. Should {A} attack anyway, it will be Oathbreaker.',
      'Tribute is cheaper than war, say the clerks. The admirals say nothing, which is its own kind of answer.',
      'Dockworkers at {R} say the convoys started loading before the ink was dry.',
    ],
    short: [
      '{B} PAYS TRIBUTE to {A} for {R}: {share} of its output until {cycle} {until}.',
      'Peace bought at {R}: {B} pays {A} {share}. The guns stay cold while the terms hold.',
      'At {R}, {B} buys off {A}[ for {terms} {cycle}s]. Attack it now and {A} is Oathbreaker.',
      'No battle at {R}: {B} pays tribute instead. Accountants on both sides call it a victory.',
      '{A} accepts {B}’s gold at {R}, and its guns go quiet[ until {cycle} {until}].',
      'Tribute at {R}. {B} pays; {A} waits. Some call it cowardice and some call it arithmetic.',
    ],
  },
  tribute_offer: {
    mood: 'politics', context: ['rumour'],
    lede: [
      '{A} has offered {B} terms over {R}: pay, and the guns stay cold.',
      'At {R}, {A} has named its price. {B} has until the next {cycle} to decide whether peace is worth it.',
      'There is a besieger at {R}, and the besieger has sent a letter. {A} would take tribute from {B} in place of the world.',
    ],
    detail: [
      'Terms of this kind are a third of the output, for a fixed term. The alternative is less arithmetical.',
    ],
    short: [
      '{A} offers {B} terms over {R}.',
      'Terms at {R}: {A} names its price.',
      '{B} weighs an offer from {A}: pay for {R}, or fight for it.',
      'At {R}, {A} would rather be paid than fight.',
    ],
  },
  coronation: {
    mood: 'politics', context: ['standings'],
    lede: [
      '{A} has taken the Hollow Throne. Whatever else is true this {cycle}, that is the news.',
      'A new reign: {A} sits the Hollow Throne[, and {prev} does not].',
      'The Throne has a new occupant. {A} will discover, as all its predecessors did, that it is not a comfortable chair.',
      'Heralds, lawyers and pretenders take note: {A} holds the Throne as of {cycle} {turn}.',
      'Long live {A}, or at least, live a while. The Hollow Throne is theirs.',
      'The Throne changes hands, as it always does. This {cycle} it is {A}’s.[ It was {prev}’s.]',
    ],
    detail: [
      '[This is reign number {reigns} in this war. ]The Throne pays more the longer it is held, which is why nobody holds it for long.',
      'Every house in the Reach now has a reason to look toward the centre of the map. They did not need another.',
      '[{prev} had held it before. ]Thrones are not lost so much as handed on, at gunpoint.',
    ],
    short: [
      '{A} TAKES THE THRONE[ from {prev}]. The Hollow Throne pays more the longer it is held.',
      'A new reign: {A} sits the Hollow Throne.[ It is reign number {reigns} in this war.]',
      'The Throne is {A}’s[, taken from {prev}]. Every house now has a reason to look toward the centre of the map.',
      '{A} is crowned in the Hollow Throne. It will discover that the chair is not comfortable.',
      'Throne changes hands: {A} in[, {prev} out]. Expect visitors.',
      '{A} holds the Throne. Long may it last, which in the Reach means not long.',
    ],
  },
  eliminated: {
    mood: 'grief', context: ['standings'],
    lede: [
      '{A} is no more. The last of its worlds has fallen silent, and its banners are memorials now.',
      'The Reach has one fewer house. {A} has fallen.',
      'It is the end of {A}. The Herald, which reported its first {cycle}, now reports its last.',
    ],
    detail: [
      'Its debts, its oaths and its dead are now matters for the historians.',
    ],
    short: [
      '{A} IS NO MORE.',
      'The last of {A} falls silent.',
      '{A} has fallen. The Reach is smaller.',
    ],
  },
  // ------------------------------------------------------------------ Fate
  fate: {
    mood: 'fate', context: ['standings', 'rumour'],
    lede: [
      '{A} has spent Fate: {use}. Fate is the one coin in the Reach that everyone can see being spent.',
      'The dice were thrown, and everyone saw {A} throw them. {useDesc}',
      'Fate, the old captains say, is spent like ammunition: rarely, and all at once. {A} has spent one. {useDesc}',
      'There are only so many tokens of Fate in a war. {A} has used another[, and has {left} left].',
      'When a house reaches for Fate, it is because it has run out of everything else. {A} has reached. {useDesc}',
      'Fate is never secret. {A} has spent a token on {use}, and the Reach has noted where it went.',
    ],
    detail: [
      '[{A} has {left} left. ]Spend them all and a house is on its own.',
      '[{C}, who commands {Ft}, will now find out whether the gamble pays. ]The Herald does not report on what Fate decides until it has decided.',
      'Where exactly this was spent, {A} has not said, and the Herald will not guess.',
    ],
    short: [
      'FATE: {A} spends a token on {use}.[ {left} left.]',
      'The dice are thrown: {A} spends Fate. {useDesc}',
      '{A} reaches for Fate: {use}.[ It has {left} left.]',
      'Fate spent by {A}. {useDesc}',
      '{A} gambles a token of Fate on {use}. Fate is never secret; only its outcome is.',
      'A token of Fate for {Ft}[, {C} commanding]. {useDesc}',
    ],
  },
  fate_bonus: {
    mood: 'fate', context: ['standings'],
    lede: [
      'Fortune favours the fallen. {A}, far behind, has been touched by Fate: a new token.',
      'The Reach has a soft spot for the underdog. {A} gains a Fate token[, trailing {leader} by {gap} VP].',
      'Fate is not fair, but sometimes it is generous. {A} has been given a new token.',
      'When a house falls far enough behind, the old stories say, Fate takes an interest. It has taken one in {A}.',
    ],
    detail: [
      '[{leader} leads on {leaderVp} VP. ]The token is a lifeline, not a promise.',
      'Comebacks are made of exactly such moments, and of very little else.',
    ],
    short: [
      'Fortune favours the fallen: {A} gains a Fate.',
      '{A}, far behind, is touched by Fate.',
      'A new Fate token for {A}[, {gap} VP adrift].',
      'Fate smiles on the trailing {A}.',
    ],
  },
  // ------------------------------------------------------------------ postures
  p_called: {
    mood: 'read', context: ['standings', 'rumour'],
    lede: [
      '{A} read the fight at {R} correctly, and its guns spoke first.',
      'CALLED IT. {Ft} read the fight at {R} before it began[: its {posture} posture was exactly right].',
      '{A} saw it coming. {Ft} took a {posture} posture at {R}[ against {B}], and the bet paid out in full.',
      'There is a moment in every battle when one side realises the other already knew. At {R}, that side was {B}.',
      'Some call it luck. The officers of {Ft} call it reading the enemy, and at {R} they read {B} like a ledger.',
      'The best shot in any battle is the one fired first. {Ft} fired it at {R}[, its {posture} posture vindicated].',
      '{Ft} bet on what {B} would do at {R}[, chose {posture},] and was right.',
    ],
    detail: [
      '[{bet}. ]It was, and {Ft} had the guns waiting.',
      '[{C} gave the order and did not explain it. ]Afterwards, nobody needed it explained.',
      '{B}’s captains will be studying this one for a while.',
    ],
    short: [
      '{A} read the fight at {R} correctly, and fired first.',
      'CALLED IT: {Ft} read {B} at {R}[ ({posture})] and fired first.',
      '{A} saw it coming: {Ft} had chosen {posture} at {R}, and {B} arrived exactly as expected.',
      '{Ft}[ under {C}] guessed right at {R}, and {B} paid for it.[ {bet}.]',
      'A good read at {R}: {Ft} was ready[ for {B}]. The first shot is the one that counts.',
      'At {R}, {Ft} struck first.[ {C} had read the fight before it began.]',
      'Right on the mark: {Ft}[ ({posture})] at {R}. {B}’s captains will be studying this one.',
    ],
  },
  p_caught: {
    mood: 'misread', context: ['grim', 'rumour'],
    lede: [
      '{A} bet wrong at {R}, and paid for it in the opening round.',
      'CAUGHT OUT. {Ft} guessed wrong at {R}[: it chose {posture}, and the road was not clear].',
      '{Ft} bet on an empty road through {R}. The road was not empty.',
      'A costly read at {R}. {Ft}[ had chosen {posture} and] was caught strung out[ by {B}].',
      'The trouble with betting on a clear path is that someone else may be standing on it. {Ft} found {B} at {R}.',
      'Every posture is a wager. {Ft} lost its wager at {R}.',
      '{A} will not be framing this one: {Ft} was caught out at {R}.',
    ],
    detail: [
      '[{bet}. ]It was not. It could not fire its first round, and it paid for every one after.',
      '[{C} has been asked to explain. ]Explanations in the Reach are cheaper than hulls.',
      'Its captains will be more careful next time. That is what the next time is for.',
    ],
    short: [
      '{A} bet wrong at {R}, and paid for it in the opening round.',
      'CAUGHT OUT: {Ft}[ ({posture})] at {R}.[ {bet}. It was not.]',
      '{Ft} guessed wrong at {R}, strung out when {B} found it.',
      'A costly read: {Ft}[ chose {posture} at {R} and] was caught out, losing its first round for it.',
      '{Ft} ran into {B} at {R}, and was not ready. The road was not as clear as advertised.',
      'Strung out and surprised: {Ft}[ under {C}] at {R}.',
      '{A}’s {F} bet on a clear road at {R}. It lost the bet, and some paint.',
    ],
  },
  p_ambush: {
    mood: 'read', context: ['grim'],
    lede: [
      'AMBUSH at {R}. {Ft} lay in wait, and {B} came exactly where it was expected.',
      'Out of the dark at {R}: {Ft} struck first, and {B} never saw it until it was too late.',
      'There is no defence against an ambush except not walking into one. {B} walked into {Ft}’s at {R}.',
      '{Ft} waited at {R}, silent and patient. {B} arrived. The rest was arithmetic.',
    ],
    detail: [
      '[{C} chose the spot. ]Ambushes are won before they begin.',
      'Survivors describe the first volley as coming from nowhere. That was the idea.',
    ],
    short: [
      'AMBUSH at {R}: {Ft} springs the trap[ on {B}].',
      'Out of the dark at {R}: {Ft} strikes first.',
      '{B} runs into {Ft}’s ambush at {R}.',
      '{Ft} lay in wait at {R}. It was worth the wait.',
    ],
  },
  p_broken: {
    mood: 'misread', context: ['grim'],
    lede: [
      'BROKEN CHARGE at {R}. {Ft} charged, and the defenders were waiting.',
      '{Ft} charged {R} expecting surprise. It found braced guns instead.',
      'A charge is a bet that the other side is not ready. At {R}, it was ready, and {Ft} paid.',
      'The defenders of {R} braced, and {Ft} charged straight into them.',
    ],
    detail: [
      '[{C} led from the front. ]The front was where the guns were pointing.',
      'A broken charge loses its first round and its pride. {Ft} lost both.',
    ],
    short: [
      'BROKEN CHARGE at {R}: {Ft} runs onto braced guns.',
      '{Ft} charges {R}, and the defenders were waiting.',
      'At {R}, {Ft}’s charge broke on {B}’s line.',
      'Charge broken: {Ft} at {R}.',
    ],
  },
  p_exposed: {
    mood: 'misread', context: ['rumour'],
    lede: [
      '{Ft} waited in the dark at {R}. Nobody came. It is now sitting in plain view, and rather tired.',
      'An ambush with no victim is merely a fleet in an awkward place. {Ft} is at {R}, exposed and weary.',
      'All {cycle}, {Ft} lay in wait at {R}. The enemy, inconsiderately, went elsewhere.',
    ],
    detail: [
      'Every house in the Reach can see it now, and its crews will be slow to their guns next {cycle}.',
    ],
    short: [
      '{Ft} waited in the dark at {R} for nobody.',
      'An ambush exposed: {Ft} at {R}.',
      'Nobody came: {Ft} sits exposed at {R}.',
    ],
  },
  p_scorched: {
    mood: 'grief', context: ['standings'],
    lede: [
      'SCORCHED EARTH. {A} burned {R} before it fell; {B} has inherited ashes.',
      '{B} took {R} and found nothing worth taking. {A} saw to that.',
      '{A} would not let {R} fall intact. Its stores, its archives and its calling went up in smoke before {B} arrived.',
    ],
    detail: [
      'A conqueror who gets nothing has still conquered, but the victory parade will be short.',
    ],
    short: [
      'SCORCHED EARTH: {A} burns {R} before it falls.',
      '{R} falls in ashes: {B} takes nothing.',
      '{A} torches {R} on the way out.',
    ],
  },
  p_levies: {
    mood: 'read', context: ['rumour'],
    lede: [
      '{R} called the levies in time. When {B} arrived, the walls were full.',
      'The bells of {R} rang before the enemy was in sight. By the time {B} came, every wall was manned.',
      'Somebody at {R} read the signs. The levies were called, and the assault met a fuller garrison than it expected.',
    ],
    detail: [
      'The Herald would like to meet whoever made the call. So, one imagines, would {B}.',
    ],
    short: [
      '{R} calls the levies: the walls fill in time.',
      'Levies man the walls of {R}[ as {B} arrives].',
      '{R} was ready. {B} was not ready for that.',
    ],
  },
  // ------------------------------------------------------------------ the Herald remembers (wave 2)
  // Obituaries: a fallen commander's notice. {dates} "turn 3 to turn 12", {age} years of service in turns.
  obituary: {
    mood: 'grief', context: ['grim'],
    lede: [
      '{C}, commander of {Ft}, died at {R} on {cycle} {turn}.[ Counted {rank} by the end,] {C} served {A}[ for {age}].',
      'The Herald records the death of {C}[, {rank}], who led {Ft} from its founding[ at {home}] until {R}.',
      'Died at {R}: {C}, of {A}.[ Commander of {Ft}, {dates}.] No family is listed. The fleet was the family.',
      '{C} is gone. For {age}, the name meant {Ft}; at {R}, it came to mean a line on a memorial wall.',
      'It is the Herald’s duty to report the death of {C}[, {rank} of {A}], lost with {Ft} at {R}.',
      'At {R}, on {cycle} {turn}, {C} gave the last order. {Ft} carried it out[, as it had for {age}].',
    ],
    detail: [
      '[Remembered as {ep}. ][Honours: {honours}. ][Scarred: {scars}. ]The banner of {Ft}[ was raised at {home} on {cycle} {founded}, and it] does not fly any more.',
      '[{killer} is credited with the blow. ]{C} leaves behind {Ft}’s name, {A}’s gratitude, and a seat at the officers’ table nobody will sit in for a while.',
      '[Service: {dates}. ][Honours: {honours}. ]{A} has lost commanders before. It has not lost many like this one.',
      '[The {battle} was the last of it. ][It earned the name {ep}. ]The quartermasters will close the ledger of {Ft} tonight.',
      '[Founded at {home} on {cycle} {founded}. ][It bore {scars}. ]Of the commander, the crews say only: never late, never lucky, never once afraid of being either.',
    ],
    short: [
      'Obituary: {C}, commander of {Ft}, died at {R}.[ Service: {dates}.]',
      '{C}[, {rank},] is dead at {R}. {Ft} flies no more.[ Remembered as {ep}.]',
      'Died at {R}: {C} of {A}, who led {Ft}[ for {age}].',
      'The Herald notes the death of {C}[, {rank} of {A},] at {R}.[ Honours: {honours}.]',
      '{C}, of {Ft}, {dates}.[ Lost at {R}.] The memorial gains a name.',
      'Lost at {R}: {C}. {A} lowers the banner of {Ft}.',
    ],
  },
  // Anniversaries of a broken oath (public). {since} "ten turns", {words} the sworn words.
  anniversary: {
    mood: 'oath', context: ['standings', 'rumour'],
    lede: [
      'It is {since} to the day since {A} broke its sworn word to {B}[ at {R}]. The Herald has not forgotten, and suspects {B} has not either.',
      '{since} ago, {A} swore an oath to {B} and then broke it. Anniversaries are usually happier things.',
      'Mark the date: {since} since {A} turned on {B}[ over {R}]. In the Reach, grudges keep better than wine.',
      'An anniversary nobody will celebrate: {since} since the betrayal of {B} by {A}.',
    ],
    detail: [
      '[The words, for the record: “{words}.” ]They were printed in these pages at the time. They read no better now.',
      '[“{words},” {A} swore. ]The Herald keeps old editions for exactly this reason.',
      '{B} has been asked whether the matter is closed. {B} declined to answer, which is an answer.',
    ],
    short: [
      '{since} since {A} broke faith with {B}.[ “{words}.”] The Herald remembers.',
      'An anniversary: {since} since the betrayal of {B} by {A}.',
      'It is {since} since {A}’s broken oath to {B}. Neither house has mentioned it. Both have thought of little else.',
      'Readers will recall {A}’s oath to {B}, broken {since} ago.[ “{words}.”]',
    ],
  },
  // The first edition of a League game: the feud (docs/DELIGHT.md #83). {nth} "fourth", {score} "Kith leads 2–1".
  feud: {
    mood: 'politics', context: ['rumour'],
    lede: [
      '{A} and {B} meet again, for the {nth} time.[ {score}.] The Herald has kept every edition, and so, it suspects, have they.',
      'Here we go again. {A} and {B} sit down at the same table for the {nth} time[, and {score}].',
      'The {nth} meeting of {A} and {B} begins this {cycle}.[ {score}.] Neither house has forgiven the last one.',
      'Old enemies, new war: {A} and {B}, the {nth} meeting.[ {score}.]',
      'The beacons are lit, and the same three houses squint at each other across the Reach. For {A} and {B}, it is the {nth} meeting.',
    ],
    detail: [
      '[Last time, {lastWinner} took the Crown. ][{ugly} still keeps the Ugly Trophy, a dented tin goblet, on the mantel. ]The Herald expects the goblet to change hands.',
      '[{A} remembers {capA} worlds taken. ][{B} remembers {capB}. ][Between them, {betrayals} broken oaths. ]Nobody at this table has a short memory.',
      '[Last game, {oathBy} swore “{oathWords}” and broke it. ][{nemA} calls {nemB} a nemesis. ]These things are not forgotten between games; they are merely postponed.',
      '[{lastWinner} won the last war in {lastTurns} {cycle}s. ][{ugly} finished last and keeps the Ugly Trophy. ]Every house says this time will be different.',
      '[Old banners are remembered: {fleet}. ][{title} sits at the table again. ]The {league} has opened a fresh page in its ledger.',
    ],
    short: [
      '{A} and {B}: the {nth} meeting.[ {score}.]',
      'The {nth} meeting of {A} and {B}.[ {ugly} carries the Ugly Trophy into it.]',
      'Again, at the same table: {A} and {B}, meeting for the {nth} time.',
      'The {league} meets again. {A} and {B} have unfinished business.[ {score}.]',
    ],
  },
  // Special editions, one per act of the war (docs/LOOPS.md §2). Public facts only.
  act_claim: {
    mood: 'muster', context: ['rumour', 'throne'],
    lede: [
      'Three beacons are lit and three houses lay claim to the Reach. The Hollow Throne waits between them, as it always has, for someone foolish or great enough to sit in it.',
      'So it begins. {A}, {B} and their rival have raised their banners, and the Herald has sharpened its pencils.',
      'Act the first: the claim. Every house is seizing what nobody else has thought to defend yet. It will not stay that easy.',
      'The war has a first page, and the Herald is printing it. Three houses, one Throne, and a great deal of empty space between them.',
    ],
    detail: [
      'The neutral worlds are going cheap this {cycle}. They will not stay cheap; nothing in the Reach does.',
      'The first {cycle}s are for scouts, colonists and optimists. The Herald has met all three, and only the scouts were sober.',
      'The houses say they want peace. They say it while building warships, which the Herald notes without comment.',
    ],
    short: [
      'Act the first: the claim. The houses are seizing what nobody defends yet.',
      'The beacons are lit. The Herald opens its ledger of the war.',
      'Three banners, one Throne. The claim begins.',
      'So it begins: the houses stake their claims across the Reach.',
    ],
  },
  act_borders: {
    mood: 'politics', context: ['standings', 'rumour'],
    lede: [
      'The borders close. For the first time, every house of the Reach can see another house’s banner from its own worlds, and none of them likes the view.',
      'There is no more empty space to fill. The three houses now touch, border to border, and the easy part of the war is over.',
      'Special edition: the Reach is full. Every frontier is someone else’s frontier now, and every move is a message.',
      'The map has run out of blank spaces. From here on, anything one house gains, another loses.',
    ],
    detail: [
      'This is the season of scans, feints and pacts. The Herald advises readers to believe nothing they are told and half of what they see.',
      'Diplomats are suddenly very busy. So are the yards. The Herald draws no conclusions, but it does draw a map.',
      '[{leader} leads on {leaderVp} VP. ]A border is a promise, the old saying goes, and promises in the Reach are made to be read carefully.',
    ],
    short: [
      'The borders close: all three houses now share a frontier.',
      'No more empty space. The houses touch, and the easy part of the war is over.',
      'Special edition: the Reach is full, and every border is someone’s.',
      'The frontiers meet. Every move from here is a message.',
    ],
  },
  act_blood: {
    mood: 'blood', context: ['grim', 'standings'],
    lede: [
      'First blood. {A} and {B} have come to it at last, house against house, and the Reach will not go back to the way it was.',
      'It was always going to happen. {A} has drawn blood from {B}, and the war has stopped pretending to be anything else.',
      'Special edition: the first blood of the war is spilled between {A} and {B}. The Herald records the date so that nobody can claim they were not warned.',
      'Until this {cycle} it was a contest. Now, with {A} and {B} at each other’s throats, it is a war.',
    ],
    detail: [
      'The Herald has seen this before: the first blow is the hardest, and the second is much easier.',
      '[{B} will not forget this. ]Somewhere, a commander is swearing a vow, and somewhere else a clerk is ordering more black ink.',
      'Every house will now read every pact twice. The third house, watching, will read them three times.',
    ],
    short: [
      'First blood: {A} against {B}. The war begins in earnest.',
      'Special edition: {A} draws first blood from {B}.',
      'House against house at last: {A} and {B}.',
      'The first blood of the war, between {A} and {B}.',
    ],
  },
  act_crisis: {
    mood: 'politics', context: ['standings', 'throne'],
    lede: [
      '{A} grows fat. With {leaderVp} VP against {trail}’s {trailVp}, the house leads the Reach by a distance that is starting to look permanent.',
      'Special edition: {A} pulls clear. The other houses can count, and they do not like the numbers.',
      'The crisis of the war is here. {A} leads on {leaderVp} VP[, {gap} clear of {trail}], and every rival is suddenly interested in the same target.',
      '{A} is winning, and everyone knows it. That is the most dangerous position in the Reach.',
    ],
    detail: [
      'The Herald observes that alliances are easiest to make against the house in front. It merely observes.',
      '[The goal is {goal} VP. ]A lead is a target, and the Reach is full of good shots.',
      'Readers are reminded that the war is not over until the Throne says so, and the Throne has said nothing yet.',
    ],
    short: [
      '{A} grows fat: {leaderVp} VP and pulling clear.',
      'Special edition: {A} leads the Reach, and the others have noticed.',
      'The crisis: {A} in front[, {gap} clear], and every house is counting.',
      '{A} leads by enough to worry everyone else.',
    ],
  },
  act_throne: {
    mood: 'glory', context: ['standings'],
    lede: [
      'The Throne is contested. {A} has reached for the Hollow Throne, and the last act of the war has begun.',
      'Special edition: all eyes on the Throne. {A} is within reach of the Crown, and the Reach holds its breath.',
      'The war has come down to a chair. {A} stands closest to it[ with {leaderVp} VP], and nobody else will let them sit in peace.',
      'Act the last: the Throne. Whatever happens now will be in the history books, if anyone survives to write them.',
    ],
    detail: [
      '[The goal is {goal} VP. ]The Herald has prepared two front pages for the end. It will print whichever is true.',
      'Every fleet in the Reach now has one question: toward the Throne, or against whoever is closest to it?',
      '[{throne} holds the Hollow Throne, {streak} running. ]The chair has never been comfortable. It is about to get less so.',
    ],
    short: [
      'The Throne is contested. {A} reaches for the Crown.',
      'Special edition: the last act begins at the Hollow Throne.',
      'All eyes on the Throne, and on {A}.',
      'The war comes down to a chair, and {A} is closest to it.',
    ],
  },
  act_last: {
    mood: 'glory', context: ['standings', 'throne'],
    lede: [
      'Last orders. One {cycle} remains in the war for the Reach, and every house has exactly one chance left to change the ending.',
      'Special edition: the final {cycle}. The candles are guttering, and {leader} leads on {leaderVp} VP.',
      'This is the last {cycle}. What is done now is done for good, and the Herald will print it all.',
      'Time is called on the war. One {cycle} of orders remains, and then the Throne will choose.',
    ],
    detail: [
      '[{leader} leads on {leaderVp} VP; {trail} trails on {trailVp}. ]The numbers can still change. They have before.',
      'Every house has one last move. The Herald advises them to make it count, and to make it memorable.',
      '[{throne} holds the Hollow Throne. ]The Herald has set the type for the final edition, all but the name.',
    ],
    short: [
      'Last orders: one {cycle} remains.[ {leader} leads on {leaderVp} VP.]',
      'Special edition: the final {cycle} of the war.',
      'Time is called. One {cycle} left to change the ending.',
      'The last {cycle}. Make it count.',
    ],
  },
  // ------------------------------------------------------------------ nothing much
  quiet: {
    mood: 'quiet', context: ['standings', 'throne', 'rumour'],
    lede: [
      'No battles of note this {cycle}. The Herald, which is paid by the column, regrets the quiet; everyone else seems to welcome it.',
      'A quiet {cycle} in the Reach. The yards hum, the convoys run, and every admiral is pretending not to be planning anything.',
      'The guns are silent. In the Reach, that has never meant peace; it means someone is counting.',
      'Nothing happened this {cycle}, according to the official channels. Unofficially, the channels are very busy.',
      'An uneasy calm lies over the Reach. The houses are building, scheming and, in at least one case, sulking.',
      'It has been a {cycle} for logistics. Logistics wins wars, the old admirals say, which is why nobody writes songs about it.',
      'All three houses spent the {cycle} gathering strength. That is the polite way of saying: arming.',
      'The Herald has checked its wires twice. Nothing has exploded. Readers are advised not to get used to it.',
    ],
    detail: [
      '{leader} leads the table on {leaderVp} VP; {trail} trails on {trailVp}.',
      '[The current edict from the Throne, {edict}, is worth {edictVp} VP to whoever earns it. ]Every house claims to be uninterested.',
      '[{throne} holds the Hollow Throne, {streak} running. The others are watching the chair more than each other.]',
      'Shipyards report full order books and empty taverns, which is how the yards like it.',
    ],
    short: [
      'Quiet in the Reach. The yards are busy; the guns are not.[ {leader} leads on {leaderVp} VP.]',
      'No battles of note. The Herald suspects this will not last.[ {throne} keeps the Throne warm.]',
      'An uneasy calm. Everyone is counting their ships, and everyone else’s.',
      'Nothing to report but rumour, and rumour is cheap this {cycle}.[ The edict, {edict}, is still unclaimed.]',
      'The houses gather their strength.[ {leader} leads on {leaderVp} VP; {trail} trails on {trailVp}.]',
      'Silence on the wires.[ The Hollow Throne sits with {throne}, {streak} running.]',
      'A {cycle} of convoys and contracts. Nobody died, which counts for something.',
    ],
  },
};

/** Things people said (never real people). Keyed by mood; each a clause without its final full stop. */
export const QUOTES: Record<Mood, string[]> = {
  war: [
    'We were told it would be quick. It was quick. It was also loud',
    'You count the ships after. Before, you just count to ten',
    'Nobody wins out there. Some people just lose more slowly',
    'I have seen bigger battles. I have not seen many that mattered more',
    'The guns did what guns do. The rest is for the historians',
    '{?V}Tell {L} the field is ours, and they may have it back when they can take it',
    'We will need more hulls, and more people who can stand inside them',
    'It was a fair fight, which is the worst kind',
  ],
  loss: [
    'They knew the odds. They went anyway. That has to count for something',
    'We will put the name on the wall, next to the others. The wall is getting crowded',
    'Ships can be rebuilt. I wish the same were true of crews',
    'Ask me again next {cycle}. Today I have nothing to say that you could print',
    'Every banner falls eventually. I had hoped this one would take longer',
    'It was a good fleet. It deserved a better day',
    'Somebody will answer for this. Probably not the right somebody',
    'The bars at {home} will be quiet tonight',
  ],
  glory: [
    'They earned it. Most of us just survived it',
    '{?V}We will drink to it tonight and pay for it tomorrow',
    'I served with them. I would serve with them again, though not on purpose',
    'There is a story in that fleet, and it is not finished',
    'Honours are just scars that came with paperwork',
    'Give it another year and they will be naming children after it',
    'The crews are insufferable now. Rightly so',
    'Good. The Reach could use a few things worth cheering',
  ],
  muster: [
    'Fresh paint, fresh crews, and a great many mistakes still waiting to be made',
    'Every fleet looks splendid on its first day',
    'The crews are young. The Reach will see to that',
    '{?V}We have a name and a banner. The rest we will earn',
    'I give it a year. I gave the last one a year too',
    'Somebody has to fly the thing. Better them than me',
  ],
  world: [
    'Flags come and go. The harbour stays where it is',
    'Every house that ever held this place said it would hold it forever',
    'The archives get a new page. The people get a new tax',
    'My grandmother saw it change hands twice. I have now seen it three times',
    'You learn not to paint the flagpoles. It saves money',
    'Worlds remember. People forget; worlds do not',
    '{?V}It was ours before, in every way that counts. Now it is ours on paper too',
    'Whoever governs us, the ships still need unloading',
  ],
  oath: [
    'A promise is a heavy thing to carry into battle. Some of us carry it anyway',
    'Words are cheap until you put them on a hull',
    'I would not have sworn it. Then again, nobody asked me',
    'Everyone swears something in the Reach. Keeping it is the trick',
    '{?V}The Herald will remember. So will we',
    'We will see what the oath is worth when the guns come out',
  ],
  blood: [
    'The ledger is open. It stays open until it is paid',
    '{?V}We do not forget. We are not built for it',
    '{?V}Somebody owes us a name. We intend to collect',
    'There is no interest charged on a blood-debt. There does not need to be',
    'Revenge is not a strategy. It is, however, a very good motivator',
    'It is not personal. It is entirely personal',
  ],
  politics: [
    'Peace is just war with better accountants',
    'Everyone has a price. The trick is being the one who names it',
    'The Throne is a chair. A chair with a great many knives pointed at it',
    'It is cheaper than a battle. Most things are',
    'Ask me again when I have read the terms. Twice',
    'Nobody likes paying. Everybody likes being paid',
    'Long may it last. Which is to say, not long',
  ],
  fate: [
    'You only get so many. You learn to spend them where people can see',
    'Luck is what you call Fate when it works',
    'Every captain prays. The clever ones pray where the enemy can hear',
    'The dice are thrown. The rest is up to the guns',
    'It is not desperation if it works',
    'Fate does not owe anybody anything. Sometimes it pays anyway',
  ],
  read: [
    '{?V}We knew. Do not ask me how we knew; we knew',
    'You do not guess in this business. You wait, and you watch, and you guess',
    '{?V}They came exactly where we said they would. I almost felt sorry for them',
    'Reading the enemy is easy. Being right about it is the hard part',
    'The first shot is the only one anybody remembers',
    '{?V}We had a feeling. The feeling had guns',
  ],
  misread: [
    'It looked like the right call at the time. Most mistakes do',
    '{?V}We bet on the wrong road. The road did not forgive us',
    '{?V}Next time we will know better. There is always a next time, if you are lucky',
    'Nobody plans to be caught out. That is rather the point of it',
    'In hindsight, I would have done it differently. Hindsight was not available',
    '{?V}The enemy got a vote. We forgot that',
  ],
  grief: [
    'We took what we could carry. It was not much',
    'There used to be a market here. There used to be a lot of things here',
    'Whoever wins this war, it will not be us',
    'They tell us it was necessary. They are not the ones sleeping in the holds',
    'Nobody chooses to leave. You just run out of reasons to stay',
    'Put it in your paper. Somebody should remember it happened',
  ],
  quiet: [
    'Quiet is the most expensive thing in the Reach. Somebody always pays for it later',
    'I have loaded more torpedoes this week than in the whole of last year. Draw your own conclusions',
    'The admirals are smiling. I have never liked it when the admirals smile',
    'Nothing is happening. That is what worries me',
    'Business is good. That is never a good sign',
    'Ask me next {cycle}. Next {cycle} there will be something to say',
    'Peace? No. This is the bit where everybody reloads',
  ],
};

/** Who said it (invented, always). Partisan sources speak for the story's house ({V}); neutral ones for nobody.
 *  Slots must be known to the audience, like everything else. */
export const SOURCES: { partisan: string[]; neutral: string[] } = {
  partisan: [
    'an officer of {V}',
    'a navigator of {V}',
    'a source close to {V}’s war council',
    'a former officer of {Ft}',
    'an old captain at {Vcap}',
    'a gunnery sergeant of {V}',
    'an unsmiling spokesman for {V}',
    'a harried quartermaster of {V}',
  ],
  neutral: [
    'a dockworker at {home}',
    'a source close to the Admiralty',
    'a chandler who sells rope to all three houses and trusts none of them',
    'a pilot who claims to have seen it',
    'a clerk of the Throne archives',
    'a hull insurer',
    'a stevedore at {R}',
    'a priest of the Cenotaph',
    'a salvage broker',
    'a tavern-keeper at {R}',
    'a retired admiral who has outlived three wars and most of her opinions',
    'a customs officer at {cap}',
  ],
};

/** Dry editorial remarks that close a short story when there is room. Keyed by mood; full sentences. */
export const ASIDES: Record<Mood, string[]> = {
  war: ['The Herald counts the wrecks so that readers need not.', 'Salvage crews send their regards.', 'Somewhere an admiral is calling it a success.', 'The war goes on. It is good at that.'],
  loss: ['The memorial walls grow longer.', 'Masons, at least, are doing well out of the war.', 'The Herald records it here, so that someone does.', 'Somewhere a clerk is ordering more black ink.'],
  glory: ['The Herald approves, cautiously.', 'Its rivals have been informed, whether they like it or not.', 'Crews will be insufferable for a week.', 'There is a song in it somewhere.'],
  muster: ['Every legend starts as a line in the shipping news.', 'The Herald wishes it luck, and will report on how much it needed.', 'Its rivals have been informed.', 'The yards are already painting the next one.'],
  world: ['Flags change; harbours stay.', 'The archives have been updated, again.', 'The governor’s chair has been dusted off, again.', 'Its history stays where it is; only the flag moves.'],
  oath: ['The Reach remembers these things.', 'Words are cheap until someone holds you to them.', 'The Herald is keeping score.', 'A promise in the Reach is a public thing.'],
  blood: ['The ledger stays open until it is paid.', 'Debts of this kind are never forgiven, only settled.', 'Avengers fight harder. Everyone knows it.', 'Blood-debts outlive the people who swore them.'],
  politics: ['Clerks on both sides are pleased; admirals less so.', 'Peace, in the Reach, is a thing you rent.', 'The terms are public; the grudges are free.', 'Everyone has a price. This was one.'],
  fate: ['Fate is never secret; only its outcome is.', 'Tokens of Fate are few, and every house can count them.', 'The dice are thrown. The guns will decide the rest.', 'The Reach watches where Fate is spent.'],
  read: ['The first shot is the one that counts.', 'Reading the enemy is half the war.', 'Somebody on the other side is being asked to explain.', 'Good guesses win more battles than good guns.'],
  misread: ['Every posture is a wager, and the house always collects.', 'Someone is being asked to explain.', 'Hindsight was not available at the time.', 'The enemy, it turns out, also gets a vote.'],
  grief: ['Nobody calls it a fair trade.', 'The Herald does not usually print the price of bread. It has risen.', 'Somebody should remember it happened.', 'War is reported in hulls. It is paid in people.'],
  quiet: ['The Herald suspects this will not last.', 'Readers are advised not to get used to it.', 'Someone, somewhere, is counting.', 'Every admiral is pretending not to be planning anything.'],
};

/** How a quote is framed: {q} = the quote (no final stop), {src} = who said it, {Src} = the same, capitalised. */
export const QUOTE_FRAMES: string[] = [
  '“{q},” said {src}.',
  '“{q},” {src} told the Herald.',
  '{Src} put it plainly: “{q}.”',
  'One who was there, {src}, asked that we print this: “{q}.”',
  'Asked for comment, {src} would say only: “{q}.”',
  '“{q},” according to {src}. The Herald has no reason to doubt it, and several to wish it untrue.',
  '{Src} was philosophical. “{q}.”',
  '“{q}.” So says {src}, and the Herald is inclined to agree.',
  'The view from the docks, courtesy of {src}: “{q}.”',
];

/** The lead's closing paragraph. Each must make sense on its own and use only public slots. */
export const CLOSERS: Record<'standings' | 'throne' | 'rumour' | 'grim', string[]> = {
  standings: [
    'The table, for the record: {leader} leads on {leaderVp} VP, and {trail} brings up the rear on {trailVp}.',
    'None of this changes who is ahead, though it may change who stays there. {leader} leads on {leaderVp} VP.',
    '{leader} still leads the Reach, with {leaderVp} VP. {trail}, on {trailVp}, has some catching up to do.',
    'In the wider war, {leader} holds the lead on {leaderVp} VP[, {gap} clear of {trail}].',
    'The houses stand: {leader} first on {leaderVp} VP, {trail} last on {trailVp}. The order has been known to change in a single {cycle}.',
    'The arithmetic of the war is unchanged at the top: {leader}, {leaderVp} VP.',
  ],
  throne: [
    'Meanwhile the Hollow Throne sits with {throne}, {streak} running, and every house is counting.',
    'Above it all, {throne} holds the Hollow Throne. For now.',
    '{?empty}The Hollow Throne stands empty, which is either a relief or an invitation.',
    '{throne} holds the Throne. The Herald has noticed that most news this {cycle} points toward it.',
  ],
  rumour: [
    'Rumour in the yards says that more is coming. Rumour in the yards usually does.',
    'The Herald hears that at least one admiralty has cancelled leave. It does not say which, because it does not know.',
    'Rumours of a secret fleet continue to circulate. There is always a secret fleet. Occasionally there is one.',
    'Insurers have raised their rates for every lane in the Reach. They know something, or they think they do.',
    'The Herald is told that {cap} is unusually busy. The Herald is told a great many things.',
    'Several readers have written in to ask whether this is the turning point. The Herald’s answer: ask us next {cycle}.',
  ],
  grim: [
    'The memorial walls of the Reach grow longer. Masons, at least, are doing well out of the war.',
    'The salvagers will be busy. They always are.',
    'There will be more of this before there is less.',
    'The Herald records it here, so that someone does.',
    'The war goes on. It is good at that.',
    'Somewhere a clerk is ordering more black ink.',
  ],
};

/** A house's dispatch from the last edition, quoted back at it. {who} = the house, {pledge} = their words. */
export const CALLBACKS: { up: string[]; down: string[] } = {
  up: [
    'Last edition, {who} told these pages: “{pledge}” It seems it was not idle talk.',
    'Readers may recall {who}’s boast in our last edition: “{pledge}” The Herald is obliged to report that it has aged well.',
    '“{pledge}” So said {who} last edition. This {cycle}, it rather looks that way.',
  ],
  down: [
    'Only last edition, {who} assured our readers: “{pledge}” The words read differently this morning.',
    '{who}’s dispatch in our last edition — “{pledge}” — now rings somewhat hollow.',
    'The Herald printed {who}’s words last edition without comment: “{pledge}” It will not need to comment now.',
  ],
};

/** Posture sentences for battle stories: what a posture read (a CALLED IT / CAUGHT OUT the audience saw) meant. */
export const READS: { called: string[]; caught: string[] } = {
  called: [
    '{pF} had read the fight before it began.',
    'It was {pF}’s read that decided it: {posture}, and right.',
    '{pA} called it: {pF} had chosen {posture}, and the blow came exactly where expected.',
  ],
  caught: [
    '{pF} had chosen {posture}, and chosen wrong.',
    'A bad read did for {pF}: {posture}, and wrong.',
    '{pA} was caught out: {pF} chose {posture}, and paid for it.',
  ],
};

/** A Fate use in prose ({F}/{Ft} = the fleet, {R} = the system for Surge). */
export const FATE_PROSE: Record<string, { use: string; desc: string }> = {
  laststand: { use: 'a Last Stand for {Ft}', desc: '{Ft} will not retreat, will not rout, and will hit harder. If it dies, it dies where it stands.' },
  twist: { use: 'a Twist of Fate to shield {Ft}', desc: 'The worst volley aimed at {Ft} this {cycle} will, by some miracle of gunnery, miss.' },
  rally: { use: 'a Rally for {Ft}', desc: '{Ft}, routed and limping, has turned around, patched its hull and come back to fight.' },
  hyperjump: { use: 'a Hyperjump for {Ft}', desc: '{Ft} has jumped further and faster than anyone thought it could. Where it has gone, nobody is saying.' },
  surge: { use: 'a Surge at {R}', desc: 'The yards and mines of {R} will run double this {cycle}.' },
};

/** Ranks as adjectives, by commander rank (1–5). */
export const RANK_WORDS = ['', 'untried', 'blooded', 'veteran', 'storied', 'legendary'];

/** Posture prose: its name (as the game shows it) and the bet it made. */
export const POSTURE_PROSE: Record<string, { name: string; bet: string }> = {
  steady: { name: 'Steady', bet: 'It bet on nothing in particular' },
  guarded: { name: 'Guarded', bet: 'It bet that the attack would come to it' },
  running: { name: 'Running', bet: 'It bet that its road was clear' },
  charge: { name: 'Charge', bet: 'It bet that the defenders would not be braced' },
  ambush: { name: 'Ambush', bet: 'It bet that the enemy would come through' },
  levies: { name: 'Call the Levies', bet: 'It bet that a siege would land' },
  scorch: { name: 'Scorched Earth', bet: 'It bet that the world would fall' },
  gates: { name: 'Open the Gates', bet: 'It bet that an ally needed refuge' },
};

/** Caps (characters) so every edition stays small on the wire. */
export const STORY_CAPS = { lead: 900, short: 360, edition: 3200 };

// ============================================================================ the Herald remembers (wave 2)
/**
 * The galaxy's war correspondent, picked by the seed (shared/sim/herald.ts correspondentOf). Invented names only.
 * Titles go after the name in a byline: "By Ottoline Vask, our correspondent at the front".
 */
export const CORRESPONDENT = {
  first: ['Ottoline', 'Barnaby', 'Ysolde', 'Cassius', 'Merrow', 'Tamsin', 'Ignatius', 'Perpetua', 'Lucan', 'Hesper', 'Odile', 'Fenwick', 'Clemency', 'Aurelio', 'Wren', 'Mabyn'],
  last: ['Vask', 'Quill', 'Marrowby', 'Thorne', 'Ashgrove', 'Penhallow', 'Strand', 'Galloway', 'Inkersole', 'Draycott', 'Fairweather', 'Mortlake', 'Sallow', 'Kettering'],
  title: [
    'our correspondent at the front',
    'the Herald’s war correspondent',
    'who files from wherever the guns are',
    'our correspondent in the Reach',
    'reporting from the front',
    'who has covered three wars and believed in none of them',
  ],
};

/**
 * Callbacks: one sentence a story borrows from the Herald's memory (annals), only when everyone in the story's
 * audience knew the earlier event. {nth} "third", {R} the system, {old} a fleet that fell there ("the Long Watch"),
 * {ago} "nine turns", {A}/{B} the houses.
 */
export const MEMORY: Record<'battle' | 'clash' | 'taken' | 'fell', string[]> = {
  battle: [
    'It was the {nth} battle fought at {R}, and the salvage crews no longer need directions.',
    '{R} has seen this before: this was the {nth} battle there.',
    'The {nth} battle of {R}. Nobody there pretends to be surprised any more.',
    'This was the {nth} time the guns have spoken at {R}. The system is becoming a graveyard with a name.',
  ],
  clash: [
    'It is the {nth} time {A} and {B} have come to blows. The Herald has stopped calling it a misunderstanding.',
    '{A} and {B} have met in battle {nth} times now, and neither has learned to like it.',
    'For the {nth} time this war, {A} and {B} settled an argument with guns.',
  ],
  taken: [
    '{R} changes hands for the {nth} time this war. Its people have stopped repainting the signs.',
    'This is the {nth} time {R} has been taken. The locals keep every flag, just in case.',
    'Taken for the {nth} time, {R} is getting used to new owners.',
  ],
  fell: [
    'It is the same place where {old} fell, {ago} ago.',
    '{R} is where {old} fell, {ago} ago. The wreckage is still there.',
    'Readers will remember {R} as the place where {old} fell, {ago} ago.',
    'This is where {old} fell, {ago} ago. Some places collect grief.',
  ],
};

/** The masthead of each special edition (HeraldEdition.special): act number, title and ornament (client art keys). */
export const ACT_EDITIONS: Record<'claim' | 'borders' | 'blood' | 'crisis' | 'throne' | 'last', { n: number; title: string; ornament: string }> = {
  claim: { n: 1, title: 'The Claim', ornament: 'beacon' },
  borders: { n: 2, title: 'The Borders Close', ornament: 'border' },
  blood: { n: 3, title: 'First Blood', ornament: 'blood' },
  crisis: { n: 4, title: 'The Crisis', ornament: 'scales' },
  throne: { n: 5, title: 'The Throne Contested', ornament: 'throne' },
  last: { n: 6, title: 'Last Orders', ornament: 'candle' },
};
