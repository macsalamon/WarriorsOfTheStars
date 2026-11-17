# Credits

## Ship pictures

The board counters (one picture per hex facing, `-f0` to `-f5`) and the ship-card pictures (`-front`) in `public/assets/ships/` are pictures of
the ship models of **Fate of the Galaxy** (FotG), the Star Wars total conversion for the FreeSpace Open engine (<https://www.fateofthegalaxy.net/>),
used with the permission of its team (asked and granted in November 2026). The models are read from the mod's own files by
`tools/fotg-to-glb.mjs` (they are `.pof` files with `.dds` textures; the mod is not part of this repository), rendered with `tools/render3d.html`
(settings per ship in `tools/ships.js`) and lined up with `tools/assemble-sprites.cjs`. The Star Destroyer's picture (`star-destroyer.png`) is one render of the mod's Imperial Star Destroyer model, cropped by `tools/assemble-destroyer.cjs`, and the Nebulon-B frigate's pictures (`nebulon-b-f0` to `-f5`) are renders of the mod's Nebulon-B model made the same way, and the Mon Calamari cruiser's (`mon-calamari-f0` to `-f5`) of the mod's Liberty.

FotG is a fan project made by volunteers; it is not associated with Lucasfilm. Its credits list, for the models and textures:
Brand-X, Limbert, Dark Visor and bobbtmann (senior 3D artists); zookeeper, Axem, Galemp, Newman, Jacek, greyleader and rhettro (3D artists);
Brand-X, swashmebuckle, CountBuggula, Limbert, Dark Visor and bobbtmann (2D artists); zookeeper (model conversion and rigging); with chief1983
as project leader. The models are adapted from the mod's files in the way described below.

| Ship in the game | FotG model |
| --- | --- |
| X-wing | `x-wing` |
| A-wing | `a-wing` |
| Y-wing (one seat and two seats) | `y-wing` (the mod has one Y-wing) |
| B-wing | `b-wing` |
| TIE Fighter | `t-fighter` |
| TIE Interceptor | `t-interc` |
| TIE Interceptor Prototype | `t-advanced` (the mod's TIE Advanced) |
| TIE Bomber | `t-bomber` |
| Lambda-class shuttle | `lambda` |
| Stock light freighter | `yt1300` |
| Millennium Falcon | `yt1300_falcon` |
| Slave I | `firespray_s1` |
| Pirate pinnace | `skipray` |
| Asteroids | `da/AstBig01_brown`, `AstBig02_blue`, `AstBig03_grey`, `AstMed01..03` and `AstSml01..03` (nine rocks, in `public/assets/rocks`) |

**The 3D board (a test, `3d.html`).** The ship models themselves are in `public/assets/models/`: the converted FotG models (one `.glb` file for each ship, with the squadron markings described below), their textures turned into WebP by `tools/model-pack.mjs` (`npm run models`). They are covered by the team's permission for this project. The same folder holds the models of the capital ships (also converted FotG models), of the single turret gun and of the two pieces of the Death Star surface model that are the double turret gun and the ground target (see the table of other models below for their makers and licences); of that last model only those two pieces are in the file.

**Effects.** The explosions, hit flashes, puffs and bolt streaks on the board are frames from the mod's `data/effects` (`exp`, `fls`, `prt`), packed by `tools/fx-pack.mjs` into the sprite sheets of `public/assets/fx`: `Exp_Det_Shp_01/02` (ships destroyed), `Exp_Ipt_Ptn/Rkt/Trb` (torpedoes, missiles, bombs and broken asteroids), `Fls_Hit_Lsr_1-6` and `Fls_Hit_Ion_01_Blu` (hit flashes), `Prt_Trl_MG7_01_Blu`, `Prt_Trl_Rkt_01_Yel/Red` and `Prt_Trl_NG2_01_Wht` (puffs for hits) and `Prt_Trl_HM6_01_Orn/Blu/Yel/Tel` (the streaks of lasers, ion cannons, torpedoes and missiles). Frames are thinned and reduced; they are drawn with additive blending.

Changes made to the models: only the ship at its best level of detail, with its base (colour) texture; no glow, reflection or normal maps;
the left-handed FreeSpace coordinates turned into ours; camera, lighting and a fixed orientation for the pictures; textures reduced to 1024 pixels.
Squadron markings, after reference pictures supplied by the owner, were added by `tools/paint.mjs`: red wing blocks, thin engine rings and red strips along the nose edges on the X-wing; gold nose and thin gold engine rings on the one-seat Y-wing (near-black in the same places on the two-seater); a green top with yellow wing patches on the A-wing; blue wing tips and a blue cockpit band on the B-wing (its red roundels are the model's own). The B-wing lies on its side, as in the board game's counters: the whole cross of the ship is turned about the line of flight while the cockpit pod stays upright (the pod is turned back in the model).

## Turret guns and the ground target

The pictures of the turret guns (`turret-single-*`, `turret-double-*`, `turret-double-reduced-*` in `public/assets/ships/`) and of the ground target (`ground-target.png`) are renders of
two models from Sketchfab, made with the same tools as the ships (`tools/render3d.html`, `tools/assemble-sprites.cjs`; settings in `tools/ships.js`). The base stands still and only
the gun turns; the double turret with a lost gun is the same model with one of its two cannons cut away. The authors are named in the model files:

| Picture | Model | Author | Licence |
| --- | --- | --- | --- |
| single turret gun | "Hoth Defense Turret - Star Wars" (<https://sketchfab.com/3d-models/hoth-defense-turret-star-wars-c675f652cce94a7b9fb143ac4d83220d>) | Quiznos323 (<https://sketchfab.com/quiznos323>) | CC BY-NC-SA 4.0 |
| double turret gun (the cannon tower) and ground target (the arena building) | "Star Wars: Death Star Surface Parts" (<https://sketchfab.com/3d-models/star-wars-death-star-surface-parts-12b06ff468534281a8820e4d7f25bdd4>) | Daniel (<https://sketchfab.com/DanielAndersson>) | CC BY 4.0 |

The pictures are adapted from the models (camera, lighting, one tile each of the surface model, a cannon cut away on one of them), and the single turret's licence is non-commercial and share-alike, like the pictures it makes.
"Heavy Turbolaser Cannon V3" by ademis (CC BY 4.0, <https://sketchfab.com/3d-models/heavy-turbolaser-cannon-v3-9818bd406a9b499395ac51ec47a0aeca>) was the double turret first and is no longer used; it is not in this repository.

## Earlier pictures (replaced)

Until the move to the FotG models the ship pictures were renders of 3D models from Sketchfab: StarWars-Universe (X-wing, A-wing, the TIEs, Lambda, Slave I;
CC BY-NC-SA 4.0), Silvia Nanni and PBC33 (Y-wings), nekodemo (B-wing), Crusty Bread (Falcon), KangaroOz 3D (stock freighter) and doclusifer2 (pirate
pinnace), all CC BY 4.0 except as noted. None of their pictures are used any more, and the files are not in this repository.
Two more models were received and never used: A/SF-01 B-wing starfighter by DrEgguin and Star Wars: B-Wing by Daniel (both CC BY 4.0, on Sketchfab).

## Crew icons

The pilot icons (`public/assets/crew/pilot-rebel.png`, `pilot-empire.png`) are the emblems of the Rebel Alliance and the Empire from the cockpit-display animations of **Fate of the Galaxy** (`data/cbanims/CB_reb_0016.png` and `CB_imp_0016.png`), cut to size; they are used with the same permission as the models above. The gunners' icons (`gunner-rebel.svg`, `gunner-empire.svg`) are a plain crosshair drawn for this game, in the colours of the two sides' laser bolts. They replace the placeholders of earlier versions (a helmet photo, a TIE pilot helmet and two emblems), which are no longer in the project.

The R2 unit icon (`public/assets/crew/r2.png`) is a render of the model **"Star Wars - R2D2"** by **timblewee** (<https://skfb.ly/oqYN9>), licensed under Creative Commons Attribution 4.0 (<http://creativecommons.org/licenses/by/4.0/>). The model comes with a floor and walls: `droidOnly` in `tools/ships.js` keeps only the droid's own parts, `tools/render3d.html?m=r2d2` renders it and `tools/assemble-r2.cjs` cuts the icon. It replaces an older cartoon picture of unknown source, which is no longer in the project.

## Sound

The sounds in `public/assets/sounds/` (weapons, hits, explosions, engine loops, buttons and signals) are files of the sound library of **Fate of the Galaxy** (`data/sounds`, version 2.0.2), used with the permission of its team. `data/sounds.json` says which file plays at which moment; `tools/sound-pack.mjs` (`npm run sounds`) converts the picked files from the mod's folder into mono MP3s, cutting the longest ones short. The mod's music and voice files are not used. The people who made the sounds are not named here yet: to be asked of the team.

## The credits page

The people and teams above are also listed on the Credits page of the menu (`src/ui/credits.ts`), with a special thank you to the Fate of the Galaxy team. Change the page and this file together.
