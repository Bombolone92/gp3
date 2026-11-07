import { PALETTE } from "./kit.js";
function intro(k, w, title, subtitle) {
  k.heading(0, 0, w, title);
  k.text(0, 60, w, subtitle);
}
// Twelve weeks starting Monday, January 4, 2027.
const MONTHS = [
  ["Jan", "janv."],
  ["Feb", "févr."],
  ["Mar", "mars"],
];
// ISO date of a weekday in the plan, for task metadata.
function isoDate(week, offset = 0) {
  return new Date(Date.UTC(2027, 0, 4 + week * 7 + offset))
    .toISOString()
    .slice(0, 10);
}
// The example plan's "today" (Wednesday, February 10, 2027) sets each
// task's status, so the Tasks view and spreadsheet export show real progress.
const TODAY = "2027-02-10";
function weekDate(k, week, offset = 0) {
  const date = new Date(Date.UTC(2027, 0, 4 + week * 7 + offset)),
    [en, fr] = MONTHS[date.getUTCMonth()],
    day = date.getUTCDate();
  return k.t(`${en} ${day}`, `${day} ${fr}`);
}
export default [
  {
    id: "gantt",
    category: "project",
    name: ["Gantt chart", "Diagramme de Gantt"],
    description: [
      "Plan tasks, milestones, and dependencies on a weekly timeline.",
      "Planifier les tâches, les jalons et les dépendances sur un calendrier hebdomadaire.",
    ],
    keywords: [
      "gantt timeline schedule project plan tasks milestones dependencies weeks",
      "gantt calendrier échéancier plan de projet tâches jalons dépendances semaines",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        2120,
        t(
          "Gantt chart: online service launch",
          "Diagramme de Gantt : lancement d’un service en ligne",
        ),
        t(
          "Each bar is a task with start and due dates, status, and an assignee you can set in Task details; its width matches its duration on the weekly scale. Arrows are dependencies. Open Tasks for the timeline and a spreadsheet export.",
          "Chaque barre est une tâche avec des dates de début et d’échéance, un statut et une personne responsable à définir dans Détails de la tâche; sa largeur correspond à sa durée sur l’échelle hebdomadaire. Les flèches sont des dépendances. Ouvrez Tâches pour le calendrier et l’exportation en feuille de calcul.",
        ),
      );
      k.frame(
        0,
        140,
        1700,
        880,
        t(
          "Timeline · January to March 2027",
          "Calendrier · janvier à mars 2027",
        ),
      );
      k.card(20, 200, 200, 60, t("Workstream", "Volet"), {
        color: PALETTE.grey,
        fontSize: 16,
      });
      k.table(
        240,
        200,
        1440,
        [
          Array.from({ length: 12 }, (_, w) =>
            t(
              `Week ${w + 1}\n${weekDate(k, w)}`,
              `Sem. ${w + 1}\n${weekDate(k, w)}`,
            ),
          ),
        ],
        { h: 60, fontSize: 14 },
      );
      const lanes = [
        [t("Discovery", "Découverte"), PALETTE.blue],
        [t("Design", "Conception"), PALETTE.purple],
        [t("Build", "Développement"), PALETTE.green],
        [t("Launch", "Lancement"), PALETTE.orange],
      ];
      lanes.forEach(([title, color], n) =>
        k.shape("lane-header", 20, 280 + n * 170, 200, 150, title, {
          color,
          fontSize: 18,
        }),
      );
      const bar = (lane, row, start, weeks, en, fr) => {
        const label = t(en, fr);
        const task = {
          assignee: null,
          start: isoDate(start),
          due: isoDate(start + weeks - 1, 4),
        };
        task.status =
          task.due < TODAY
            ? "done"
            : task.start <= TODAY
              ? "in-progress"
              : "todo";
        return k.shape(
          "terminator",
          240 + start * 120,
          300 + lane * 170 + row * 60,
          weeks * 120 - 10,
          50,
          label,
          { color: lanes[lane][1], fontSize: 14, task },
        );
      };
      bar(0, 0, 0, 3, "User research", "Recherche auprès des usagers");
      const mapping = bar(
        0,
        1,
        2,
        2,
        "Service mapping",
        "Cartographie du service",
      );
      const prototypes = bar(1, 0, 4, 2, "Prototypes", "Prototypes");
      const testing = bar(
        1,
        1,
        6,
        2,
        "Usability testing",
        "Tests d’utilisabilité",
      );
      // The audit sits above the alpha build so each arrow has its own path.
      const alpha = bar(2, 1, 4, 4, "Alpha build", "Version alpha");
      const audit = bar(
        2,
        0,
        8,
        2,
        "Accessibility audit",
        "Audit d’accessibilité",
      );
      const beta = bar(
        3,
        0,
        9,
        2,
        "Beta with 500 users",
        "Bêta avec 500 usagers",
      );
      const elbow = { lineType: "elbow", color: PALETTE.muted };
      // Task-to-task arrows are dependencies: the earlier task blocks the next.
      const blocks = { ...elbow, dependency: "blocks" };
      k.connect(mapping, prototypes, blocks);
      k.connect(prototypes, testing, blocks);
      k.connect(testing, audit, blocks);
      k.connect(alpha, beta, blocks);
      const milestone = (x, y, en, fr, above = false) => {
        const diamond = k.shape("diamond", x - 30, y, 60, 60, "", {
          color: PALETTE.yellow,
        });
        // A label above, on two lines, stays clear of the arrows that come in
        // from the left and below.
        k.text(
          above ? x - 80 : x + 36,
          above ? y - 42 : y + 16,
          above ? 160 : 200,
          t(en, fr),
          {
            fontSize: 14,
            bold: true,
            textAlign: above ? "center" : "left",
          },
        );
        return diamond;
      };
      milestone(720, 290, "Discovery complete", "Fin de la découverte");
      // Above the Beta bar, so the audit's arrow passes over it.
      const live = milestone(
        1620,
        745,
        "Go live\nMar 26",
        "Mise en service\n26 mars",
        true,
      );
      k.connect(audit, live, elbow);
      k.connect(beta, live, elbow);
      k.line(900, 270, 900, 960, {
        lineStyle: "dashed",
        color: PALETTE.emphasis,
        lineWidth: 2,
      });
      k.text(910, 960, 200, t("Today · Feb 10", "Aujourd’hui · 10 févr."), {
        fontSize: 14,
        bold: true,
      });
      k.frame(
        1740,
        140,
        380,
        880,
        t("How to read this chart", "Comment lire ce diagramme"),
      );
      k.shape("terminator", 1760, 200, 140, 40, "", { color: PALETTE.green });
      k.text(1920, 205, 180, t("Task with dates", "Tâche avec dates"), {
        fontSize: 16,
      });
      k.shape("diamond", 1800, 260, 60, 60, "", { color: PALETTE.yellow });
      k.text(1920, 275, 180, t("Milestone", "Jalon"), { fontSize: 16 });
      k.line(1760, 360, 1900, 360, { endCap: "arrow", color: PALETTE.muted });
      k.text(
        1920,
        345,
        180,
        t(
          "Finish before the next task starts",
          "Finir avant la tâche suivante",
        ),
        {
          fontSize: 16,
        },
      );
      k.line(1830, 420, 1830, 480, {
        lineStyle: "dashed",
        color: PALETTE.emphasis,
        lineWidth: 2,
      });
      k.text(1920, 435, 180, t("Today", "Aujourd’hui"), { fontSize: 16 });
      k.card(
        1760,
        520,
        340,
        200,
        t(
          "One column is one week. A bar that spans three columns lasts three weeks. When you move a bar, update its dates in Task details; the Tasks timeline and spreadsheet export use them.",
          "Une colonne correspond à une semaine. Une barre sur trois colonnes dure trois semaines. Quand vous déplacez une barre, mettez à jour ses dates dans Détails de la tâche; le calendrier des tâches et l’exportation en feuille de calcul les utilisent.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
      k.note(
        1760,
        740,
        t(
          "Risk: accessibility audit vendor not yet booked",
          "Risque : fournisseur de l’audit d’accessibilité non réservé",
        ),
        { w: 340, h: 140, color: PALETTE.orange },
      );
    },
  },
  {
    id: "dependency-map",
    category: "project",
    name: ["Dependency map", "Carte des dépendances"],
    description: [
      "Show which teams wait on each other and highlight the critical path.",
      "Montrer quelles équipes dépendent les unes des autres et le chemin critique.",
    ],
    keywords: [
      "dependency map dependencies teams blockers critical path program planning",
      "carte des dépendances équipes obstacles chemin critique planification de programme",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        2120,
        t("Dependency map", "Carte des dépendances"),
        t(
          "Place each work item in its team’s lane and the sprint it is planned for. Draw an arrow from the item that must finish first, label it, and highlight the chain that decides the launch date.",
          "Placez chaque élément dans le couloir de son équipe et le sprint prévu. Tracez une flèche depuis l’élément qui doit se terminer en premier, nommez-la et mettez en évidence la chaîne qui fixe la date de lancement.",
        ),
      );
      k.frame(
        0,
        140,
        1680,
        830,
        t(
          "Benefits modernization program",
          "Programme de modernisation des prestations",
        ),
      );
      ["1", "2", "3", "4"].forEach((s, n) =>
        k.card(240 + n * 360, 200, 340, 50, t(`Sprint ${s}`, `Sprint ${s}`), {
          color: PALETTE.grey,
          fontSize: 18,
          textAlign: "center",
        }),
      );
      [
        t("Product team", "Équipe produit"),
        t("Policy team", "Équipe des politiques"),
        t("Vendor", "Fournisseur"),
        t("Platform team", "Équipe plateforme"),
      ].forEach((title, n) =>
        k.shape("lane-header", 20, 270 + n * 170, 200, 150, title, {
          color: PALETTE.blue,
          fontSize: 18,
        }),
      );
      const card = (lane, sprint, en, fr, critical = false) =>
        k.card(290 + sprint * 360, 300 + lane * 170, 240, 90, t(en, fr), {
          color: critical ? PALETTE.orange : PALETTE.white,
          textAlign: "left",
        });
      const questions = card(
        0,
        1,
        "Design eligibility questions",
        "Concevoir les questions d’admissibilité",
        true,
      );
      const form = card(
        0,
        2,
        "Build the application form",
        "Créer le formulaire de demande",
        true,
      );
      const launch = card(
        0,
        3,
        "Launch online application",
        "Lancer la demande en ligne",
        true,
      );
      const rules = card(
        1,
        0,
        "Approve eligibility rules",
        "Approuver les règles d’admissibilité",
        true,
      );
      const privacy = card(
        1,
        1,
        "Privacy impact assessment",
        "Évaluation des facteurs relatifs à la vie privée",
      );
      const address = card(
        2,
        1,
        "Deliver address lookup service",
        "Livrer le service de recherche d’adresse",
      );
      const security = card(
        2,
        2,
        "Security assessment",
        "Évaluation de la sécurité",
      );
      const identity = card(
        3,
        0,
        "Set up identity sign-in",
        "Mettre en place la connexion",
      );
      const payments = card(
        3,
        2,
        "Build payments API",
        "Créer l’API de paiement",
      );
      const load = card(3, 3, "Load testing", "Tests de charge");
      const critical = {
        color: PALETTE.emphasis,
        lineWidth: 4,
        lineType: "elbow",
      };
      const normal = { color: PALETTE.muted };
      const blocks = t("blocks", "bloque"),
        needs = t("needs", "requis");
      k.connect(rules, questions, { ...critical, text: blocks });
      k.connect(questions, form, { ...critical, text: blocks });
      k.connect(form, launch, { ...critical, text: blocks });
      k.connect(address, form, { ...normal, text: needs });
      k.connect(privacy, form, { ...normal, text: blocks });
      k.connect(security, launch, { ...normal, text: blocks });
      k.connect(identity, payments, { ...normal, text: needs });
      k.connect(payments, load, { ...normal, text: needs });
      k.connect(load, launch, { ...normal, text: blocks });
      k.frame(1720, 140, 400, 830, t("Legend", "Légende"));
      k.line(1740, 220, 1860, 220, {
        endCap: "arrow",
        color: PALETTE.emphasis,
        lineWidth: 4,
      });
      k.text(1880, 205, 220, t("Critical path", "Chemin critique"), {
        fontSize: 16,
      });
      k.line(1740, 280, 1860, 280, { endCap: "arrow", color: PALETTE.muted });
      k.text(1880, 265, 220, t("Other dependency", "Autre dépendance"), {
        fontSize: 16,
      });
      k.card(1740, 320, 120, 60, "", { color: PALETTE.orange });
      k.text(
        1880,
        335,
        220,
        t("On the critical path", "Sur le chemin critique"),
        { fontSize: 16 },
      );
      k.card(
        1740,
        420,
        360,
        160,
        t(
          "blocks: the next item cannot start until this one is done.\nneeds: the next item uses an output from this one.",
          "bloque : l’élément suivant ne peut pas commencer avant la fin de celui-ci.\nrequis : l’élément suivant utilise un résultat de celui-ci.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
      k.note(
        1740,
        600,
        t(
          "Review this map at every program sync. Escalate any late item on the critical path the same day.",
          "Revoyez cette carte à chaque rencontre du programme. Signalez le jour même tout retard sur le chemin critique.",
        ),
        { w: 360, h: 160 },
      );
    },
  },
  {
    id: "raci",
    category: "project",
    name: ["RACI chart", "Matrice RACI"],
    description: [
      "Clarify who is responsible, accountable, consulted, and informed.",
      "Préciser qui réalise, qui approuve, qui est consulté et qui est informé.",
    ],
    keywords: [
      "raci responsibility matrix roles accountable consulted informed",
      "raci matrice des responsabilités rôles approuve consulté informé",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1700,
        t("RACI chart", "Matrice RACI"),
        t(
          "List the key activities as rows and the roles as columns. Give each cell one letter, then check each row against the rules of thumb.",
          "Inscrivez les activités principales en lignes et les rôles en colonnes. Attribuez une lettre par case, puis vérifiez chaque ligne selon les règles de base.",
        ),
      );
      k.frame(
        0,
        140,
        1200,
        540,
        t("Responsibility matrix", "Matrice des responsabilités"),
      );
      k.table(
        20,
        200,
        1160,
        [
          [
            t("Activity", "Activité"),
            t("Product owner", "Responsable du produit"),
            t("Service designer", "Designer de services"),
            t("Developer", "Développeur"),
            t("Policy analyst", "Analyste des politiques"),
            t("Privacy officer", "Agent de la vie privée"),
          ],
          [
            t("Set the product vision", "Définir la vision du produit"),
            "A/R",
            "C",
            "I",
            "C",
            "I",
          ],
          [
            t("Conduct user research", "Mener la recherche auprès des usagers"),
            "A",
            "R",
            "I",
            "C",
            "I",
          ],
          [
            t("Write eligibility rules", "Rédiger les règles d’admissibilité"),
            "C",
            "C",
            "I",
            "A/R",
            "C",
          ],
          [
            t("Design the online form", "Concevoir le formulaire en ligne"),
            "A",
            "R",
            "C",
            "C",
            "I",
          ],
          [
            t("Build and test the service", "Développer et tester le service"),
            "A",
            "C",
            "R",
            "I",
            "I",
          ],
          [
            t(
              "Complete the privacy assessment",
              "Terminer l’évaluation de la vie privée",
            ),
            "A",
            "C",
            "C",
            "C",
            "R",
          ],
          [
            t("Approve the release", "Approuver la mise en production"),
            "A",
            "I",
            "R",
            "I",
            "C",
          ],
          [
            t("Report on outcomes", "Rendre compte des résultats"),
            "A/R",
            "C",
            "I",
            "I",
            "I",
          ],
        ],
        {
          columnWidths: [360, 160, 160, 160, 160, 160],
          // French role names take two lines.
          rowHeights: [60, 50, 50, 50, 50, 50, 50, 50, 50],
        },
      );
      k.frame(1240, 140, 460, 540, t("Legend", "Légende"));
      [
        [
          t("R · Responsible: does the work", "R · Réalise : fait le travail"),
          PALETTE.green,
        ],
        [
          t(
            "A · Accountable: owns the outcome and signs off",
            "A · Approuve : assume le résultat et l’approuve",
          ),
          PALETTE.orange,
        ],
        [
          t(
            "C · Consulted: gives input before decisions",
            "C · Consulté : donne son avis avant les décisions",
          ),
          PALETTE.blue,
        ],
        [
          t(
            "I · Informed: kept up to date after decisions",
            "I · Informé : tenu au courant après les décisions",
          ),
          PALETTE.purple,
        ],
      ].forEach(([text, color], n) =>
        k.card(1260, 200 + n * 110, 420, 90, text, {
          color,
          textAlign: "left",
          fontSize: 18,
        }),
      );
      k.frame(0, 720, 1700, 220, t("Rules of thumb", "Règles de base"));
      [
        t("Exactly one A per activity.", "Exactement un A par activité."),
        t("At least one R per activity.", "Au moins un R par activité."),
        t(
          "Too many Cs slow decisions: keep only the people you need.",
          "Trop de C ralentissent les décisions : gardez seulement les personnes nécessaires.",
        ),
        t(
          "A role with no empty cells may be overloaded.",
          "Un rôle sans case vide est peut-être surchargé.",
        ),
      ].forEach((text, n) =>
        k.note(20 + n * 420, 780, text, {
          w: 400,
          h: 140,
          color: PALETTE.yellow,
        }),
      );
    },
  },
  {
    id: "risk-register",
    category: "project",
    name: ["Risk register", "Registre des risques"],
    description: [
      "Log risks with ratings, owners, and mitigations, and see them on a heat map.",
      "Consigner les risques avec leur cote, leur responsable et leurs mesures, sur une carte de chaleur.",
    ],
    keywords: [
      "risk register risks issues mitigation heat map likelihood impact",
      "registre des risques problèmes atténuation carte de chaleur probabilité impact",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1720,
        t("Risk register", "Registre des risques"),
        t(
          "Record each risk as “If this happens, then this impact”. Rate likelihood and impact from 1 to 3, multiply them for the rating, assign an owner, and place the ID on the heat map.",
          "Formulez chaque risque ainsi : « Si ceci arrive, alors cet impact ». Cotez la probabilité et l’impact de 1 à 3, multipliez-les, nommez un responsable et placez l’identifiant sur la carte de chaleur.",
        ),
      );
      k.frame(0, 140, 1720, 620, t("Register", "Registre"));
      k.table(
        20,
        200,
        1680,
        [
          [
            "ID",
            t("Risk", "Risque"),
            t("Likelihood", "Probabilité"),
            t("Impact", "Impact"),
            t("Rating", "Cote"),
            t("Owner", "Responsable"),
            t("Mitigation", "Mesure d’atténuation"),
            t("Status", "État"),
          ],
          [
            "R1",
            t(
              "If the vendor delivers late, then the launch slips",
              "Si le fournisseur livre en retard, le lancement est reporté",
            ),
            "3",
            "3",
            "9",
            "Maya",
            t(
              "Weekly vendor check-ins; fallback manual process",
              "Suivis hebdomadaires; processus manuel de rechange",
            ),
            t("Open", "Ouvert"),
          ],
          [
            "R2",
            t(
              "If peak traffic exceeds capacity, then the site slows",
              "Si le trafic dépasse la capacité, le site ralentit",
            ),
            "2",
            "3",
            "6",
            "Sam",
            t(
              "Load test at 3x expected traffic",
              "Test de charge à 3 fois le trafic prévu",
            ),
            t("In progress", "En cours"),
          ],
          [
            "R3",
            t(
              "If French content is late, then we cannot launch",
              "Si le contenu français est en retard, impossible de lancer",
            ),
            "2",
            "2",
            "4",
            "Léa",
            t(
              "Translate each sprint, not at the end",
              "Traduire à chaque sprint, pas à la fin",
            ),
            t("Open", "Ouvert"),
          ],
          [
            "R4",
            t(
              "If key staff leave, then knowledge is lost",
              "Si du personnel clé part, le savoir est perdu",
            ),
            "1",
            "3",
            "3",
            "Priya",
            t(
              "Pairing and shared documentation",
              "Travail en binôme et documentation commune",
            ),
            t("Monitoring", "Surveillance"),
          ],
          [
            "R5",
            t(
              "If the privacy assessment finds issues, then design changes",
              "Si l’évaluation de la vie privée relève des problèmes, la conception change",
            ),
            "1",
            "2",
            "2",
            "Alex",
            t(
              "Involve the privacy office from discovery",
              "Associer le bureau de la vie privée dès la découverte",
            ),
            t("Closed", "Fermé"),
          ],
          ["", "", "", "", "", "", "", ""],
          ["", "", "", "", "", "", "", ""],
        ],
        {
          columnWidths: [60, 380, 120, 110, 110, 160, 520, 220],
          h: 530,
          rowHeights: [40, 70, 70, 70, 70, 70, 70, 70],
        },
      );
      k.frame(0, 800, 760, 480, t("Heat map", "Carte de chaleur"));
      const colors = [
        [PALETTE.yellow, PALETTE.orange, PALETTE.red],
        [PALETTE.green, PALETTE.yellow, PALETTE.orange],
        [PALETTE.green, PALETTE.green, PALETTE.yellow],
      ];
      const placed = [
        ["R4", "R2", "R1"],
        ["R5", "R3", ""],
        ["", "", ""],
      ];
      [
        t("Impact: high", "Impact : élevé"),
        t("Impact: medium", "Impact : moyen"),
        t("Impact: low", "Impact : faible"),
      ].forEach((label, r) => {
        k.card(20, 860 + r * 120, 100, 100, label, {
          color: PALETTE.grey,
          fontSize: 14,
        });
        for (let c = 0; c < 3; c++)
          k.card(140 + c * 200, 860 + r * 120, 180, 100, placed[r][c], {
            color: colors[r][c],
            fontSize: 20,
            textAlign: "center",
          });
      });
      [
        t("Likelihood: low", "Probabilité : faible"),
        t("Likelihood: medium", "Probabilité : moyenne"),
        t("Likelihood: high", "Probabilité : élevée"),
      ].forEach((label, c) =>
        k.card(140 + c * 200, 1220, 180, 40, label, {
          color: PALETTE.grey,
          fontSize: 14,
          textAlign: "center",
        }),
      );
      k.frame(800, 800, 920, 480, t("Rating guide", "Guide de cotation"));
      [
        [
          t("1 to 2 · Low: monitor", "1 à 2 · Faible : surveiller"),
          PALETTE.green,
        ],
        [
          t(
            "3 to 4 · Medium: plan a mitigation",
            "3 à 4 · Moyen : planifier une mesure",
          ),
          PALETTE.yellow,
        ],
        [
          t("6 · High: act this sprint", "6 · Élevé : agir pendant ce sprint"),
          PALETTE.orange,
        ],
        [
          t(
            "9 · Critical: escalate today",
            "9 · Critique : signaler aujourd’hui",
          ),
          PALETTE.red,
        ],
      ].forEach(([text, color], n) =>
        k.card(
          820 + (n % 2) * 450,
          860 + Math.floor(n / 2) * 120,
          430,
          100,
          text,
          {
            color,
            fontSize: 18,
            textAlign: "left",
          },
        ),
      );
      k.card(
        820,
        1100,
        880,
        160,
        t(
          "Rating = likelihood × impact. Review the register at every sprint review, close risks that no longer apply, and turn risks that happen into issues with an action plan.",
          "Cote = probabilité × impact. Revoyez le registre à chaque revue de sprint, fermez les risques qui ne s’appliquent plus et transformez les risques réalisés en problèmes avec un plan d’action.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
    },
  },
];
