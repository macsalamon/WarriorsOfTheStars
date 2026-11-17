# How to play

Starfighter duels on a hex map. Two sides plan their ships' moves in secret, then the ships take turns to fly and shoot. The game rolls all the dice, looks up all the tables and keeps track of all the markers for you, so this guide explains the rules, not the bookkeeping. Hover over almost anything in the game to see the numbers behind it.

This page explains the game as it is played here. You do not need any other rulebook.

---

## The game in a minute

- Each side has a handful of ships. Each ship has a pilot (and sometimes gunners) who have **skills**, **weapons**, a **body rating** (how much damage it takes before it breaks up) and sometimes **shields**.
- All **game-turns** follow the same rhythm: *initiative → planning → hazards → markers → ship phases (movement & weapon fire)*.
- In **planning** you pick *actions* for each ship (speed up, bank, slip, jink, pinpoint fire…). Every action makes the ship harder to fly; the game adds it all up as the plan's **difficulty**.
- In the **hazard** step each pilot rolls against that difficulty. Roll badly and something breaks.
- In a **ship phase**, one ship at a time flies exactly as many hexes as its speed (turning when its turn number allows) and then fires at targets in front of it.
- **Victory points** are scored for destroying and damaging enemy ships. The scenario says when the game ends.

---

## Ships and crews

### What a ship has

| Stat | Meaning |
|---|---|
| **Current speed** | How many hexes the ship has to move this turn. You change it with actions. |
| **Maximum speed** | The highest speed the ship can reach without *overspeed*. Engine damage lowers it. |
| **Turn number** | How many hexes in a straight line the ship needs to fly before it may turn. It depends on the speed (slow ships turn tightly) and on your maneuvers. |
| **Body rating** | How many body points the ship can lose. When all are lost, it is destroyed. |
| **Shields** | Each shield marker takes one point of power off a hit (see *Fire*). Some ships have none. |
| **Guns** | Each gun has a *gun code* (see below). |
| **Action difficulties** | For each action, how much it adds to the difficulty of the plan. Large, clumsy ships have larger numbers. |
| **Auxiliary power / R2** | Only with the optional damage rules: a stock of energy for free actions, or an astromech droid. |

Every ship's record sheet in the game shows its exact numbers.

### Skill

A **skill code** such as `5D+1` means *roll five six-sided dice and add 1*. Pilots have two skills: **piloting** (used for hazard rolls) and **gunnery** (used for shots). Gunners have a gunnery skill. Both come from the crew member's quality.

At the start of the game, the game rolls a number of dice that depends on the crew member's **quality**, and turns the total into their skill code (a very low total gives `2D`, a very high one `11D+2`):

| Quality | Dice rolled for the code | Typical code |
|---|---|---|
| Trainee | 1 | about 3D |
| Poor | 2 | about 4D |
| Average | 3 | about 5D |
| Veteran | 4 | about 6D+1 |
| Hot-shot | 5 | about 7D+2 |

The *skill reduction* setting in the menu makes those start-up rolls less random (levels 1 to 3 pull the dice toward the average). It changes nothing else.

Hits can lower skill (the damage code **Sk-1** takes one die). A pilot who falls below 1D loses consciousness and the ship is lost; a gunner who falls below 1D loses consciousness and takes no further part.

### Gun codes

A gun code has three letters, for example: **`QLF`**.

1. **Number of barrels:** S single, D double, T triple, Q quad.
2. **Power class:** L light, M medium, H heavy.
3. **Mounting:** F fixed, S swivel, P pivot (a turret).

`(I)` after the code means an **ion cannon**; `(R)` means rear-mounted.

The barrels and the mounting set the **to-hit number** (lower is easier); the barrels and the power class set the **power** (higher hurts more). Both depend on the range: ranges 1 to 5 each have their own value, ranges 6 to 10 share one. Fixed and swivel guns only fire into the forward centre arc; a swivel gun has the better (lower) to-hit numbers.

---

## The map

- The map is a field of hexes. Each ship **faces toward one of the six hex sides**. Hex numbers (column, then row) can be switched on in the toolbar.
- Around a ship there are six 60° **arcs**: *forward centre*, *forward left*, *forward right*, *rear left*, *rear right*, *rear centre*. The forward centre arc is a 60° wedge straight ahead; out to five hexes it covers 13 hexes. A hex exactly on the edge of the wedge belongs to the arc beside it.
- **Tailing:** you tail an enemy ship when it is in your forward centre arc, you are in its rear centre arc, and it is at most ten hexes away.
- **Escaping:** a ship that leaves the map has *escaped*. It is out of the game, not destroyed, and gives nobody points unless the scenario says so.

Two kinds of map, chosen in the menu (each scenario has its own default):

| Map | What happens at the edge |
|---|---|
| **Static** | There is a real edge. Flying off it is escaping. |
| **Adjustable** | Space has no edge; the view follows the fleet. A ship escapes if the whole fleet would end up wider than 29 columns or taller than 41 rows. |

Asteroid fields and the Ground Attack always use the static map.

---

## A game-turn

1. **Order of play.** The two sides settle who moves when (*Initiative*).
2. **Planning.** Both sides plan every ship in secret and at the same time. Plans are revealed when both are in.
3. **Hazards.** Every pilot rolls a skill check against the difficulty of their plan; a failed roll brings damage.
4. **Markers.** Speed changes take effect, shields are moved, tracking markers are placed. With an asteroid field, the asteroids drift now.
5. **Ship phases.** The ships move and fire one by one in the agreed order. In its phase a ship first **moves** (with snap fire along the way, if planned), then fires its weapons (the **fire segment**), then has an **end segment** (damage control, if it is used).
6. **Bookkeeping.** Temporary effects expire; the next turn starts.

---

## Initiative

**Standard:** both sides roll the piloting skill of their best pilot. The higher roll chooses a ship to move first, then the sides alternate choosing a ship that has not yet moved, until everyone has moved. A tie is rolled again.

**Passing and stealing.** Tailing can break the alternation:

- You choose one of **your** ships, and an enemy ship is tailing it: the enemy may **steal** the move, so the tailing ship moves first and yours second. A stolen move can be stolen again by another ship that is tailing the stealer, so a chain of tails resolves from the end: if A is tailed by B and B by C, and each steals, C moves, then B, then A.
- You choose an **enemy** ship that is tailing one of your unmoved ships: its owner may **pass** the move, so your tailed ship moves first and the enemy ship second. Passes do not chain.
- Only one ship may steal from, or pass to, a given ship. Nobody is ever forced to.

**Advanced** (an option, off by default): see *Optional rules*. It replaces all of the above.

---

## Planning

### Actions

You give each ship any set of the actions below (gunners can only take a few of them). Every action has a **difficulty number** on the ship's record sheet. Most can be **doubled** (×2): a stronger effect, at twice the difficulty.

| Action | Effect (×1 / ×2) | Hazard row |
|---|---|---|
| **Accelerate** | speed +1 / +2 | E |
| **Over-accelerate** | speed +3 / +4 | E |
| **Decelerate** | speed −1 / −2 | E |
| **Over-decelerate** | speed −3 / −4 | E |
| **Overspeed** | may exceed the maximum speed by 1 / 2 | E |
| **Bank** | turn number −1 / −2 | D |
| **Overturn** | turn number −3 / −4 | D |
| **Slip** | move sideways instead of forward; turn number +1 | C |
| **½ Loop** | reverse the ship's facing in one hex (twice if doubled) | C |
| **Roll** | shots at and by the ship are harder by 5 per level (if both roll, the difference counts); turn number +1 | C |
| **Jink** | shots at the ship +5 / +10; turn number +1 | C |
| **Pinpoint fire** | the ship's shots −5 / −10 to hit | F |
| **Snap fire** | take a volley during the move (see *Movement*) | F |
| **Targeting** | your shots at the tracked ship are easier (−5 / −10); but shots at you from other ships are easier by the same amount | G |
| **Angle deflectors** | move 1 / 2 shield markers (front and rear, or to the sides for big ships) | G |
| **Damage control** | repair (optional rules) | A |

Not allowed: more than one speed action per ship (accelerate, decelerate or their "over" forms), and bank together with overturn. Targeting needs a target to track (see *Tailing and targeting*), and *Angle deflectors* needs a ship that has shields.

### Speed

A ship has to move **exactly** as many hexes as its current speed. Speed actions take effect in the Markers step, after the hazard roll, so the move already uses the new speed. A ship can only go faster than its maximum speed if it also plans **overspeed**. To keep that speed it has to plan overspeed *every* turn (it only needs to accelerate the first time); otherwise it drops back to the maximum. A ship at **speed 0** may turn freely.

### Turn number

The turn number starts from the ship's value for its current speed, then the planned actions and damage add to it or take away from it. It never goes below ½; at ½ the ship may turn twice after every hex.

### Secrecy and forced markers

Neither side sees the other's plans until both have planned. Damage can force actions into next turn's plan (a **forced roll**, a forced **overspeed**); the game adds them for you.

---

## Hazards

**Total difficulty** is the sum of the difficulty numbers of every planned action (doubled actions twice), plus the ship's **stabilizer damage** and **action penalty** numbers if it has any.

Each crew member with something planned **rolls their skill** (the pilot's piloting skill, a gunner's own) against it.

- A successful skill roll: no hazard.
- A failed roll falls short of the difficulty by some amount, the *shortfall*. Every full **5** points of shortfall is one **hazard**.
- Any leftover points are one **minor hazard**.

Each hazard is a 2d6 roll on one **row** of the hazard table. Every action has a hazard letter (the last column of the action table; the planning box shows it in a small circle beside the action). The letters run from **A** to **G**, roughly from the worst results to the mildest, so the letter tells you how risky an action is. The damage codes the rows hand out are listed under *Damage*. The ship's rows are the letters of its planned actions in alphabetical order: the first hazard uses the first row, the next hazard the second, and so on, starting again when the rows run out. Two actions with the same letter give only one row. A roll of 7 does nothing. A hazard gives two damage results from its row; a minor hazard only the first.

Stabilizer damage and an action penalty count as row B. Free actions (optional rules) add no difficulty but still count as planned for the rows.

---

## Between planning and moving (the Markers step)

- **Speeds** change by the planned amounts (limited by maximum speed and overspeed).
- **Shield markers** are moved.
- **Tracking markers** are placed on ships that planned targeting (see *Tailing and targeting*).

---

## Movement

Each ship phase, the moving ship moves exactly its speed, one hex at a time. The game only offers steps that leave a legal way to finish the move, so you can never get stuck.

### Moving and turning

- **Forward:** one hex in the direction the ship faces.
- **Turning:** once the ship has flown as many hexes as its turn number, it may turn 60° to the left or right. After a turn it has to fly a full turn number of hexes again before the next one. Unused turns are not saved up.

### Slips

A planned slip *has to* be flown at least once. A **single slip** moves along the diagonal, alternating a diagonal hex with a straight one; a **double slip** moves diagonally every hex. A slip lasts at least as many hexes as the turn number, or the whole move if that is shorter. Hexes of a slip count as forward movement for turning.

### Half loops

A planned half loop reverses the ship's facing within one hex. Before it, the ship has to fly straight for as many hexes as its turn number (counted from the start of the move or from the previous loop). A doubled half loop has to be flown twice.

If a planned slip or loop cannot be flown at all (for example, at too low a speed), it is dropped and the log says so.

### Snap fire

A crew member who planned **snap fire** may take one volley **during** the move: from any hex except the first and the last, and only after moving at least one hex since the previous snap shot. A single snap fire *replaces* that crew member's volley at the end of the move; a doubled one lets them fire at the end as well.

### Leaving the map

If a move ends off the map (static) or too far from the rest of the fleet (adjustable), the ship has escaped. The game warns you before a step would do that.

---

## Fire

### Who can shoot at what

- At the **end of its move** (the fire segment), and during the move for snap fire, a crew member may fire any number of their weapons that can reach.
- **Pilots** shoot at targets in the **forward centre arc** within **5 hexes**. Gunners with a turret (pivot gun) may fire in any direction within 5 hexes; a rear-mounted turret only behind.
- A pilot can also fire the ship's turrets, but then they act like fixed guns: forward only.
- **Missiles and torpedoes** (optional) reach 10 hexes; bombs only hit a stationary ship in the same hex.
- A ship that **rolled** this turn cannot use its gunners' turrets, but the pilot's guns (turrets included) still work.

### Difficulty number of a shot

Start from the gun's to-hit number at that range, then add:

| Situation | Modifier |
|---|---|
| Same facing | + the difference between the two speeds |
| Opposite facing | + both speeds added |
| Any other facing | + the target's speed |
| Firer in a half loop | +5 |
| Target in a half loop | −5 |
| Firer or target jinking | +5 each (+10 each if doubled), they add |
| Rolls | +5 for every level one side rolls more than the other |
| Pinpoint fire (firer) | −5 / −10 |
| Firer tracking this target | −5 / −10 |
| Target tracking another ship | −5 / −10 |

"Same facing" and "opposite facing" mean exactly the same or opposite hex side; every other angle is "any other".

### Several weapons

Each weapon a crew member fires in a volley after the first costs **one die** of gunnery skill for that volley. Missile and torpedo tubes together count as one weapon. The aiming screen shows how many dice you keep as you switch weapons on.

### Rolling to hit

The shooter rolls their gunnery skill. **A roll equal to or above the difficulty hits.**

### Damage

1. Roll **2d6**.
2. Add the gun's **power** at that range.
3. Subtract the **shields** guarding the side that was hit (see *Quarters and shields*). Ion cannons ignore shields.
4. **14 or more destroys the ship outright.**
5. Otherwise a result of 2 or less does nothing. (An ion cannon still looks up its result; anything below −1 counts as −1.)
6. Otherwise look the result up in the **Fire Table** (columns −1 to 13) on the line for the side that was hit. It names one to three damage codes (see *Damage*), all applied together.

**Ion cannons** cannot do body damage: any body result is ignored. A power-loss result against an ion hit with no shield left in that box does nothing.

### Quarters and shields

The Fire Table has a **front** line and a **rear** line. A shot at a ship uses the line of the side the firer is on: from the target's forward arcs is *front*, from its rear arcs *rear*. Shield markers sit in a front box and a rear box; each marker in the box facing the shot takes one point off its power.

Ships with a body rating of **10 or more** (shuttle, freighter, Falcon, Slave I, pinnace) are bigger targets and have **advanced arcs**: see *Optional rules*.

### Victory points for hits

Destroying a ship scores its **ship value** plus its **pilot** (1, 2, 4, 8, 16 by quality) plus any **gunners** still aboard (1, 1, 2, 4, 8). Every hit that gives an **engine**, **body point** or **skill** result to a ship that survives scores **1 point** (one per result, not per body point). The ship values appear in the force-building screen.

---

## Damage

| Code | Effect |
|---|---|
| **A+3 / A+6** | *Action penalty:* the difficulty of next turn's plan rises by 3 (or 6). A second A+3 makes it 6. |
| **Body** *(n)* | The ship loses n body points; at its body rating it is destroyed. |
| **E** | *Engine:* maximum speed −1. If the ship was at the old maximum, its speed drops too. |
| **G** | *Gun:* one gun loses a barrel (quad to triple, to double, to single); a single gun is destroyed. For a hit, the owner chooses which gun. |
| **L** | *Lateral control:* turn number +1 for the rest of the game. A second one makes it +2. |
| **LOSE** | The ship loses one planned action with the same letter as the row (the owner chooses if several qualify). A single overturn, over-accelerate or over-decelerate becomes a doubled bank, accelerate or decelerate; a doubled action becomes single. |
| **P** | *Power loss:* the ship loses a shield marker from the box that was hit; if that box is empty, it loses a body point instead. (With the damage rules, the owner may give up a unit of auxiliary power or the R2 unit instead.) |
| **Roll** | Next turn the ship has to roll, in addition to everything else it plans. |
| **SPD?** | *Random speed change:* roll a die; 4 or more raises the speed by the amount shown, otherwise it lowers it. Going above the maximum forces overspeed. |
| **Sk-1** | The pilot loses one die of both piloting and gunnery skill (with gunners aboard, the owner may choose a gunner instead). |
| **Stb** | *Stabilizer damage:* the ship's stabilizer difficulty is added to the difficulty of every plan from now on. A second hit doubles it. |
| **T+1 / T+2 / T+3** | Turn number rises by that much for this turn only. |

Damage stays until it is repaired, and repairs only exist with damage control (optional).

---

## Tailing and targeting

Targeting locks your attention onto a ship, so your shots at it get easier. You can plan **Targeting** against an enemy ship you are **tailing**. (A gunner with a pivot gun can also lock onto an enemy facing the same way, and a ship can lock onto a turret gun or the ground target straight ahead of it.) In the Markers step a **tracking marker** goes onto your ship (a *double* marker if the action was doubled or two crew members planned it), and your shots at that target get −5 (−10 if doubled).

There is a price: while you track one ship, shots at you from **other** ships are easier by the same amount, because you are not watching them. The ship you track gets no such help.

---

## Optional rules

All of these are switches in the menu. Some scenarios switch some on.

### R2 units, auxiliary power and damage control

With these rules on, every ship also has its **lower body rating** (the second number on its record sheet).

- Some ships carry an **R2 unit** (X-wing, both Y-wings); others have units of **auxiliary power**. No ship has both.
- Before planning each turn, the game rolls for each R2 unit: on 5 or less it is *ready* and can pay for one action for free (difficulty 4 or less, or a doubled action of difficulty 2 or less). Otherwise it can only help with damage control.
- Auxiliary power pays for actions step by step: each step costs one unit, which is gone for good. Free steps add nothing to the difficulty but still count for the hazard rows.
- **Damage control** repairs one level of one kind of damage (guns, body, engine, lateral control, stabilizer) at the end of the ship's phase. Choose what to repair when you plan it; it can only be planned if something is damaged. Roll 2d6: **6 or less** repairs one level (**8 or less** if doubled), **7–8** (single) does nothing, **9 or more** ruins that system for good. A ship may try once per turn. An R2 unit makes the action free, not successful.
- A power loss can cost auxiliary power or the R2 unit instead of a shield.

### Gunners and turrets

Some ships carry **gunners** with their own skill and a turret each.

- A gunner may plan only pinpoint fire, snap fire, targeting and angling deflectors. A gunner makes their own hazard roll for their own actions, and only some hazard results affect them.
- A gunner's turret fires in all directions within 5 hexes, with the gunner's skill. Only one crew member may fire a given turret in a turn; whoever fires first keeps it.
- Each crew member counts their own weapons for the several-weapons penalty. A ship's tracking marker helps everyone aboard.

### Missiles, torpedoes and bombs

- X-wing, B-wing and Y-wing: proton torpedoes; Falcon: concussion missiles; TIE bomber: concussion bombs. The record sheet shows how many are left.
- Only the **pilot** fires them, in the fire segment or as snap fire, at targets in the forward centre arc up to **10 hexes**, not from a hex in which the ship turned. Choose how many tubes fire together. Each tube rolls separately; all together count as one weapon for the several-weapons penalty.
- Each weapon has its own to-hit numbers. Pinpoint fire does not help, and the target's **body rating** is subtracted from the difficulty (big ships are easier to hit).
- Damage is not rolled on the Fire Table: the weapon's dice (torpedo 2, missile 3, bomb 4) are added up, less the shield markers of the side hit; the rest are **body points**.
- Bombs hit only a stationary ship in the same hex and are never dropped automatically.

### Advanced arcs

Ships with a body rating of **10 or more** have a front, rear, **left** and **right** side:

- A shot from the target's forward centre arc uses the Fire Table's *front* line; from the rear centre arc, the *rear* line; from either of the four side arcs, the **port/starboard** line.
- Shields have four boxes. The front box guards against the forward centre arc, the rear box against the rear centre arc, the left box against the two left arcs, the right box against the two right arcs.
- *Angle deflectors* may take a marker from any box to any other (two when doubled).
- At the start these ships hold their shields spread over all four boxes (shuttle and Slave I 2/2/1/1, Falcon 3/3/1/1, freighter and pinnace 1/1/1/1, in front/rear/left/right order).

Smaller ships keep the plain front and rear boxes. The option is **on by default**.

### Advanced initiative

Replaces the standard way of choosing ships, passing and stealing (see *Initiative*).

- Before planning, **every ship's pilot rolls** piloting skill, openly. The highest roll's owner says *when* that ship moves (first, last, second…), then the next-highest, and so on. No two ships take the same slot. A tie goes to the faster ship; equal speeds roll again. When a ship has only one slot left it takes it.
- A ship that is **tailing** an enemy may instead **move with** it. When the tailed ship's slot comes, the tailer's owner says whether it moves *before* or *after* it. Only one ship may move with a given ship; chains are allowed, loops are not.

### Asteroid fields

The game makes the field and moves it; nobody places or moves rocks. The map is static.

- **Density:** sparse 5%, medium 10%, dense 15% of the hexes.
- **Rocks** are compact shapes of 1 to 7 hexes, mostly small. The set-up areas are as crowded as the rest.
- **Drifting:** each rock starts with a direction and a speed (0 to 3) and moves each turn after the Markers step. Two rocks that would overlap bounce; on a 6 a hex breaks off the smaller one. **Dice events:** each turn a few random events (2, 4 or 6) move all rocks of one size by a die roll; they bump into each other the same way.
- What is lost from the field (broken off, flown off) comes back as new rocks at the edge.
- **Collisions with ships:** when a rock and a ship share a hex (either one moved there), the pilot rolls against **3 per hex of the rock's size plus the total difficulty of the ship's plan**. A failed roll costs as many body points as the shortfall, minus one for each shield marker on the side hit. The move goes on either way.
- **Shooting rocks:** guns and special weapons can shoot rocks (toggle "Shoot asteroids"). The difficulty is the gun's number +10 + the firer's own speed. A hit removes a hex if the 2d6 roll plus power reaches 14. Ion cannons do nothing.
- Warning triangles on the board show a pilot's chance of getting through each rock hex on the planned path unharmed.

---

## Scenarios

| Scenario | In short |
|---|---|
| **Dogfight (mixes one to four)** | Two fleets fight until one side is gone (destroyed or escaped). Some mixes give one side bonus points at the start. |
| **Ground attack** | Attackers against a base of turret guns round a ground target (below). |
| **Convoy** | Attackers against a convoy of weak ships, with escorts (below). |
| **Asteroid Run** | The Falcon runs a dense asteroid field while five TIE fighters come in later (below). |
| **Star Destroyers (mixes one to six)** | A fighter battle with an Imperial Star Destroyer, and in some mixes a Rebel Mon Calamari cruiser (below). |
| **Points game** | Each side buys ships, pilots and gunners with a points limit; costs equal victory-point values. If the limits differ, the side with less gets one bonus point per two points of difference. |
| **Ship showcase** | Not a scenario: every ship type for the Rebels against one TIE fighter. |

### Ground attack

- One side **defends** a base: a **ground target** (10 body points, only body points count; destroying it scores **10**) and **turret guns** (single and double). The other side attacks. The map is static.
- The **standard base** is three double turrets round an empty hex with six singles in a ring outside. The defender places the base by hand (or the game does for the computer) at least ten hexes from every edge and the ground target at least two hexes from every gun. The attackers then choose an edge in secret; the defender is told only when everyone has placed.
- **Turret guns** come as singles and doubles, each with its own to-hit and power numbers by range (shown on its sheet), and skill 5D unless you change it in the menu. They fire in their **forward centre arc** at ships within 10 hexes, **once per turn**, and not while a friendly ship is in the arc and nearer.
- **Orders:** during planning the owner turns each turret one hex side, chooses a ship to track and sets the **upper limit** (the chance to hit at which it fires at once, default 50%) and **lower limit** (the least chance for a last-chance shot, default 20%). Each turret fires at the **last chance** to hit a ship on its path: just before the ship leaves the arc, or at the end of its move. Shots that cannot hit are not fired. Tracking the same ship two turns running makes the marker double. Orders are secret until both sides have planned.
- **Difficulty** of a turret's shot: its number, the target's jinks, tracking, and the target's speed unless the turret is directly ahead of or behind the target. Hits use the Fire Table's front or rear line.
- **Shooting turrets:** an ordinary shot with +10 against the ground target. Against the ground target only body damage counts, so a modified roll of 14 or more is not a kill there: it does the body damage of the last Fire Table column plus 1 for every point above 13 (a gun shot can never destroy it on its own). A **G** result destroys a single turret (takes a barrel from a double one); 5 body points in one shot destroy a turret, and it **blows up**, hurting every ship within two hexes. Special weapons are 5 easier against turrets and 10 easier against the ground target (their body ratings). A special weapon that misses a turret, the ground target or an asteroid by 3 or less is a **near miss** and still does damage, with one die fewer.
- **Victory points:** single turret 2, double turret 3, ground target 10.
- The game ends when no attacker is left. There is no turn limit.

### Convoy

- Some ships carry the tag **convoy** (freighters, a shuttle). The side that has them tries to bring them off the map; the other side tries to stop them.
- Every convoy ship that **escapes** earns its owner **10 victory points**.
- The game ends when **every convoy ship** is gone (destroyed or escaped) or **every attacker** is gone.
- In mixes two and three a tie in points goes to the Rebels.
- The convoy normally plays on the **static map**. On the **adjustable** map some mixes give the convoy's side extra ships.
- Each convoy ship has one gunner.

### Asteroid Run and reserves

- The Rebel player chooses the **top or bottom edge** and places the Millennium Falcon (hot-shot pilot, no gunners) along it, in a **dense asteroid field**. The asteroids rest during game-turn 1.
- The five Imperial TIE fighters (veterans) wait **in reserve**, off the map. At the end of game-turn 1 (the Markers step) the Empire places them anywhere along the **same edge**.
- The Falcon can leave the map only across the **opposite edge**. Another edge is closed to it unless it has no other way left.
- The game ends at once: the **Rebels win** if the Falcon leaves across the far edge or all the TIE fighters are destroyed, the **Empire wins** if the Falcon is destroyed.
- **Reserves** in general: ships that wait off the map and come in later, as a scenario says. They come in at the Markers step of a given game-turn, or when their owner decides at the start of a game-turn (from a given game-turn on), sometimes with a die roll: 6 the first time, then 5, then 4 and so on. A group is placed along an edge, two hexes deep, sometimes all within a few hexes of each other.

### Capital ships: Star Destroyers, Mon Calamari cruisers and frigates

- A **Star Destroyer** is a capital ship eight hexes big, a big hexagon of seven hexes with one hex in front of it, and 8 **structure points**. Capital ships turn on their second hex from the front (the front hex of the hexagon): the hex in front swings round it. It moves by itself after the Markers step and before the ships. It has no plan and no actions, but its owner sets its **speed** every game-turn: half a hex more, half a hex less or the same, between 0 and 5; it moves as many hexes as its speed rounded up (4½ moves 5). The turn number goes with the hexes (hexes / turn number): 5/3, 4/3, 3/2, 2/1, 1/1, 0/½. It turns badly, speeds up and slows down slowly. It can turn one hex side after as many hexes as its turn number; standing still it turns freely. Its owner moves it (or the computer does); the side that won the initiative moves its Star Destroyers first, and the sides alternate.
- It **fires at every fighter** that moves within 10 hexes of it, once at each, at the moment on the fighter's path (and the place on the Star Destroyer) that suits it best. It rolls two dice, 1 less if the fighter is straight ahead of its nose, 1 less again if it has fired already this turn; the **Star Destroyer Attack Table** gives the guns that fire (a 2: none). Each gun is an attack of its own, with the Star Destroyer's gunnery skill (5D unless the scenario or you say otherwise); its difficulty comes from the table, the fighter's range, and its target marker and tracking. Damage is rolled as for any hit.
- A fighter that ends its move within 10 hexes of a Star Destroyer that fired at it gets a **target marker**: the Star Destroyer's later shots at it are 5 easier. It comes off when the fighter is further away, or the Star Destroyer didn't fire at it.
- **Shooting a Star Destroyer:** a gun reaches it if it reaches one of its hexes. The shot is against the rear line of the Fire Table; the shields are 6 minus the structure points it has lost; only body and P results count, and 2 body points take 1 structure point. A 12 on the damage die can also hit a vital system. Ion cannons do nothing. For missiles, torpedoes and bombs the ship's body rating is taken off the difficulty (40 for a Star Destroyer, 25 for a Mon Calamari cruiser, 8 for a frigate: the bigger, the easier to hit), and the damage dice less the ship's shields (6 for a Star Destroyer, less the structure points it has lost) have to make 8 body points in one shot for a structure point. A torpedo (2D) can't hurt an undamaged Star Destroyer; it works once the shields are down. Missiles (3D) and bombs (4D) can hurt it from the start.
- **Vital systems** (roll two dice): 2 chain reaction (roll again: 2 to 11 it is dead in space, 12 it explodes and fighters within 3 hexes are hit), 3 fire control damaged, 4 or 8 explosions (one more structure point), 5 steering damaged (no more turns), 6, 7 and 10 nothing, 9 power loss (one hex less per turn), 11 guns damaged (all its attack rolls 1 less), 12 bridge destroyed (it moves out of control for six turns).
- **Crashing:** a Rebel fighter that a Star Destroyer destroys flies on in a straight line for the movement it had left. If that line touches the Star Destroyer the pilot rolls against 20 and 5 for every hex to the point of impact: a success hits a vital system, a roll within 3 of it costs a structure point.
- The Rebels' **Mon Calamari cruiser** is their flagship: a Star Destroyer with one structure point less (7) and one shield more (7), six hexes big, that handles better (its speed changes by a whole hex a game-turn; hexes / turn number 5/3, 4/2, 3/2, 2/1, 1/½, 0/½); mixes two to five give the Rebels one. The **Nebulon-B frigate**, which either side may have, is a small Star Destroyer of two hexes: 4 structure points and it is dead in space after 4 (15 victory points for the other side, 30 if it blows up), 3 shields, gunnery 4D, speed 0 to 6 changing by one hex a game-turn (6/3, 5/3, 4/2, 3/2, 2/1, 1/1, 0/½), only the first column of the attack table (no ion guns), and a missile, torpedo or bomb needs 6 body points in one shot to cost it a structure point.
- In a points game you can buy capital ships: a Star Destroyer (Empire) or a Mon Calamari cruiser (Rebels) for 100 points, a Nebulon-B frigate (either side) for 30. They have no pilot or gunners to buy.
- On a static map a capital ship that flies off the edge has **escaped**: it is out of the game, like a ship.
- A capital ship that has played in a turn starts at a speed a step under its top speed (4 for a Star Destroyer or cruiser, 5 for a frigate), so it can speed up at once.
- With **8 structure points lost** it can't fire any more, with 9 it is dead in space and can't move either (a cruiser: 7 and 8; a frigate: dead in space at 4). **Capital ships fire at each other** once a turn, after all of them have moved: each one picks one enemy capital ship within its range (20 hexes, 15 for a frigate, measured from any of its hexes to the nearest hex of the target) as its target (nothing to pick when there is only one, and no shot when there is none in range), and then all fire together: a die for every structure point it had left, each 6 takes one off the target.
- **Victory points** for the other side: 50 when it can't fire any more, 75 when it is dead in space, 100 when it blows up (not added up).
- The game ends when all the fighters of a side are gone and its Star Destroyers have lost 8 structure points. Mix one is six X-wings against one Star Destroyer; mixes two to five are the dogfights with a Star Destroyer for the Empire and a Mon Calamari cruiser for the Rebels; mix six is 9 A-wings and 6 B-wings (2 bonus points) against a Star Destroyer (gunnery 6D) and 3 TIE interceptors.
