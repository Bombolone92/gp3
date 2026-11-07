import { PALETTE } from "./kit.js";
// Heading and short instructions shared by every layout in this file.
function intro(k, w, title, subtitle) {
  k.heading(0, 0, w, title);
  k.text(0, 60, w, subtitle);
}
// Retrospective columns with a prompt, example notes and an empty note each,
// followed by an actions table spanning the board.
function retroBoard(k, columns, action) {
  const { t } = k,
    width = columns.length * 420 - 40;
  columns.forEach(({ title, prompt, color, examples, mood }, n) => {
    const x = n * 420;
    k.frame(x, 140, 380, 520, title);
    k.card(x + 20, 200, mood ? 260 : 340, 60, prompt, {
      color: PALETTE.grey,
      textAlign: "left",
    });
    if (mood) k.shape(mood, x + 300, 200, 60, 60, "", { color });
    examples.forEach((text, e) =>
      k.note(x + 20 + e * 180, 280, text, { w: 160, h: 140, color }),
    );
    k.note(x + 20, 440, t("Add your idea", "Ajoutez votre idée"), {
      w: 160,
      h: 140,
      color,
    });
  });
  k.frame(
    0,
    700,
    width,
    260,
    t("Actions and owners", "Actions et responsables"),
  );
  k.table(
    20,
    760,
    width - 40,
    [
      [t("Action", "Action"), t("Owner", "Responsable"), t("Due", "Échéance")],
      [action, "Sam", t("Next sprint", "Prochain sprint")],
      ["", "", ""],
      ["", "", ""],
    ],
    { columnWidths: [width - 480, 200, 240] },
  );
}
const actionRow = (k, en, fr) => k.t(en, fr);
export default [
  {
    id: "scrum-board",
    category: "agile",
    name: ["Scrum board", "Tableau Scrum"],
    description: [
      "Track a sprint from backlog to done around a shared sprint goal.",
      "Suivre un sprint du carnet jusqu’à « terminé » autour d’un objectif commun.",
    ],
    keywords: [
      "sprint backlog stories points task board",
      "carnet récits points tableau des tâches",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1760,
        t("Scrum board", "Tableau Scrum"),
        t(
          "Keep the sprint goal visible. Pull stories from the product backlog during planning, move them right as work progresses, and review the board at every daily stand-up.",
          "Gardez l’objectif du sprint bien visible. Tirez les récits du carnet de produit lors de la planification, déplacez-les vers la droite à mesure que le travail avance et revoyez le tableau à chaque mêlée quotidienne.",
        ),
      );
      k.frame(0, 140, 1760, 160, t("Sprint goal", "Objectif du sprint"));
      k.card(
        20,
        200,
        1000,
        80,
        t(
          "Sprint 14 goal: applicants can save a benefits application and finish it later.",
          "Objectif du sprint 14 : les demandeurs peuvent enregistrer une demande de prestations et la terminer plus tard.",
        ),
        {
          color: PALETTE.navy,
          textColor: "#ffffff",
          fontSize: 20,
          textAlign: "left",
        },
      );
      k.card(
        1040,
        200,
        700,
        80,
        t(
          "Mar 3 to Mar 14 · Velocity: 32 points · Yellow: story · Orange: bug · Blue: technical task",
          "Du 3 au 14 mars · Vélocité : 32 points · Jaune : récit · Orange : bogue · Bleu : tâche technique",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
      const story = (en, fr, color = PALETTE.yellow) => [t(en, fr), color];
      const columns = [
        [
          t("Product backlog", "Carnet de produit"),
          [
            story(
              "As an applicant, I want email reminders about unfinished applications · 5 pts",
              "En tant que demandeur, je veux des rappels par courriel pour mes demandes inachevées · 5 pts",
            ),
            story(
              "As an agent, I want to see the applicant’s saved answers · 8 pts",
              "En tant qu’agent, je veux voir les réponses enregistrées du demandeur · 8 pts",
            ),
            story(
              "Upgrade the forms library · 3 pts",
              "Mettre à niveau la bibliothèque de formulaires · 3 pts",
              PALETTE.blue,
            ),
            story(
              "As an applicant, I want to upload documents from my phone · 13 pts",
              "En tant que demandeur, je veux téléverser des documents depuis mon téléphone · 13 pts",
            ),
          ],
        ],
        [
          t("To do", "À faire"),
          [
            story(
              "As an applicant, I want to save my progress · 5 pts · Priya",
              "En tant que demandeur, je veux enregistrer ma progression · 5 pts · Priya",
            ),
            story(
              "Store drafts for 30 days · 3 pts · Alex",
              "Conserver les brouillons pendant 30 jours · 3 pts · Alex",
              PALETTE.blue,
            ),
            story(
              "As an applicant, I want a list of my saved applications · 5 pts",
              "En tant que demandeur, je veux la liste de mes demandes enregistrées · 5 pts",
            ),
          ],
        ],
        [
          t("In progress", "En cours"),
          [
            story(
              "As an applicant, I want to resume where I left off · 8 pts · Sam",
              "En tant que demandeur, je veux reprendre là où j’en étais · 8 pts · Sam",
            ),
            story(
              "Session expires without warning · 2 pts · Léa",
              "La session expire sans avertissement · 2 pts · Léa",
              PALETTE.orange,
            ),
          ],
        ],
        [
          t("Review", "Révision"),
          [
            story(
              "As an applicant, I want a clear “Save and exit” button · 3 pts · Priya",
              "En tant que demandeur, je veux un bouton « Enregistrer et quitter » clair · 3 pts · Priya",
            ),
          ],
        ],
        [
          t("Done", "Terminé"),
          [
            story(
              "Accessibility check of the save flow · 2 pts · Léa",
              "Vérification de l’accessibilité du parcours d’enregistrement · 2 pts · Léa",
              PALETTE.blue,
            ),
            story(
              "As an applicant, I want to sign in to see my drafts · 5 pts · Sam",
              "En tant que demandeur, je veux me connecter pour voir mes brouillons · 5 pts · Sam",
            ),
          ],
        ],
      ];
      columns.forEach(([title, notes], n) => {
        const x = n * 360;
        k.frame(x, 340, 320, 720, title);
        notes.forEach(([text, color], r) =>
          k.note(x + 20, 400 + r * 150, text, { w: 280, h: 130, color }),
        );
      });
    },
  },
  {
    id: "kanban",
    category: "agile",
    name: ["Kanban board", "Tableau Kanban"],
    description: [
      "Visualize flow with work-in-progress limits and an expedite lane.",
      "Visualiser le flux avec des limites de travail en cours et un couloir urgent.",
    ],
    keywords: [
      "kanban flow wip limit swimlane to do doing done",
      "kanban flux limite travail en cours couloir à faire en cours terminé",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1860,
        t("Kanban board", "Tableau Kanban"),
        t(
          "Pull the next card only when a column is under its WIP limit. Urgent work uses the Expedite lane. Finish work before starting new work.",
          "Tirez la carte suivante seulement quand une colonne est sous sa limite de travail en cours. Le travail urgent passe par le couloir Urgent. Terminez avant de commencer.",
        ),
      );
      k.shape("lane-header", 0, 200, 160, 160, t("Expedite", "Urgent"), {
        color: PALETTE.orange,
        fontSize: 18,
      });
      k.shape("lane-header", 0, 380, 160, 520, t("Standard", "Standard"), {
        color: PALETTE.grey,
        fontSize: 18,
      });
      const columns = [
        [
          t("Backlog", "Carnet"),
          PALETTE.grey,
          null,
          [
            t(
              "Plain language review of the letters",
              "Révision en langage clair des lettres",
            ),
            t(
              "Add French search synonyms",
              "Ajouter des synonymes de recherche en français",
            ),
          ],
        ],
        [
          t("Ready (WIP 5)", "Prêt (limite 5)"),
          PALETTE.yellow,
          null,
          [
            t(
              "Update the eligibility page",
              "Mettre à jour la page d’admissibilité",
            ),
            t(
              "Fix the date picker on mobile",
              "Corriger le sélecteur de date sur mobile",
            ),
          ],
        ],
        [
          t("In progress (WIP 3)", "En cours (limite 3)"),
          PALETTE.green,
          t(
            "Outage notice on the home page",
            "Avis de panne sur la page d’accueil",
          ),
          [
            t("New confirmation email", "Nouveau courriel de confirmation"),
            t(
              "Blocked: waiting for the privacy review",
              "Bloqué : en attente de l’examen de la vie privée",
            ),
          ],
        ],
        [
          t("Review (WIP 2)", "Révision (limite 2)"),
          PALETTE.blue,
          null,
          [
            t(
              "Contact form accessibility fixes",
              "Corrections d’accessibilité du formulaire",
            ),
          ],
        ],
        [
          t("Done", "Terminé"),
          PALETTE.purple,
          null,
          [
            t(
              "Status page shows processing times",
              "La page d’état affiche les délais",
            ),
            t("Updated office hours", "Heures d’ouverture mises à jour"),
          ],
        ],
      ];
      columns.forEach(([title, color, urgent, notes], n) => {
        const x = 200 + n * 340;
        k.frame(x, 140, 300, 780, title);
        if (urgent)
          k.note(x + 20, 210, urgent, {
            w: 260,
            h: 120,
            color: PALETTE.orange,
          });
        k.line(x + 20, 370, x + 280, 370, { lineStyle: "dashed" });
        notes.forEach((text, r) =>
          k.note(x + 20, 400 + r * 150, text, {
            w: 260,
            h: 130,
            color: text.startsWith(t("Blocked", "Bloqué"))
              ? PALETTE.red
              : color,
          }),
        );
      });
      k.frame(0, 960, 1860, 220, t("Board policies", "Règles du tableau"));
      [
        t(
          "Pull, don’t push: take new work only when you have capacity.",
          "Tirer plutôt que pousser : prenez du travail seulement si vous avez de la capacité.",
        ),
        t(
          "Expedite: one card at a time, for outages and legal deadlines only.",
          "Urgent : une carte à la fois, seulement pour les pannes et les échéances légales.",
        ),
        t(
          "Blocked cards turn red. Swarm on them before starting new work.",
          "Les cartes bloquées deviennent rouges. Réglez-les en équipe avant tout nouveau travail.",
        ),
        t(
          "Done means tested, accessible, bilingual and released.",
          "Terminé signifie testé, accessible, bilingue et mis en production.",
        ),
      ].forEach((text, n) =>
        k.card(20 + n * 460, 1020, 440, 120, text, {
          color: PALETTE.grey,
          textAlign: "left",
        }),
      );
    },
  },
  {
    id: "sprint-planning",
    category: "agile",
    name: ["Sprint planning", "Planification de sprint"],
    description: [
      "Agree on a sprint goal, team capacity, and the work to commit to.",
      "S’entendre sur l’objectif, la capacité de l’équipe et le travail à engager.",
    ],
    keywords: [
      "sprint planning capacity velocity commitment estimate",
      "planification capacité vélocité engagement estimation",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1760,
        t("Sprint planning", "Planification de sprint"),
        t(
          "1. Agree on why the sprint matters. 2. Check who is available. 3. Select backlog items that fit the capacity. 4. Name the risks before you commit.",
          "1. Convenez de l’importance du sprint. 2. Vérifiez qui est disponible. 3. Choisissez les éléments du carnet selon la capacité. 4. Nommez les risques avant de vous engager.",
        ),
      );
      k.frame(0, 140, 860, 320, t("1. Sprint goal", "1. Objectif du sprint"));
      k.card(
        20,
        200,
        820,
        120,
        t(
          "Applicants can track the status of their application online without calling the contact centre.",
          "Les demandeurs peuvent suivre l’état de leur demande en ligne sans appeler le centre de contact.",
        ),
        {
          color: PALETTE.navy,
          textColor: "#ffffff",
          fontSize: 22,
          textAlign: "left",
        },
      );
      k.card(
        20,
        340,
        400,
        100,
        t("Sprint 15 · Mar 17 to Mar 28", "Sprint 15 · Du 17 au 28 mars"),
        { color: PALETTE.grey, textAlign: "left" },
      );
      k.card(
        440,
        340,
        400,
        100,
        t(
          "Success looks like: 70% fewer “where is my application?” calls in the pilot.",
          "La réussite : 70 % moins d’appels « où en est ma demande? » pendant le projet pilote.",
        ),
        { color: PALETTE.green, textAlign: "left" },
      );
      k.frame(
        900,
        140,
        860,
        320,
        t("2. Team capacity", "2. Capacité de l’équipe"),
      );
      k.table(
        920,
        200,
        820,
        [
          [
            t("Person", "Personne"),
            t("Role", "Rôle"),
            t("Days available", "Jours disponibles"),
            t("Capacity (points)", "Capacité (points)"),
          ],
          ["Priya", t("Developer", "Développeuse"), "9", "10"],
          ["Sam", t("Developer", "Développeur"), "7", "8"],
          ["Léa", t("Designer", "Designer"), "10", "8"],
          ["Alex", t("Tester", "Testeur"), "8", "6"],
          [t("Total", "Total"), "", "34", "32"],
        ],
        { columnWidths: [200, 220, 200, 200] },
      );
      k.frame(
        0,
        500,
        1100,
        560,
        t("3. Selected backlog", "3. Carnet sélectionné"),
      );
      k.table(
        20,
        560,
        1060,
        [
          [
            "ID",
            t("Backlog item", "Élément du carnet"),
            t("Estimate", "Estimation"),
            t("Owner", "Responsable"),
          ],
          [
            "BA-41",
            t(
              "Status page with the current step",
              "Page d’état avec l’étape actuelle",
            ),
            "8",
            "Priya",
          ],
          [
            "BA-42",
            t(
              "Email when the status changes",
              "Courriel lors d’un changement d’état",
            ),
            "5",
            "Sam",
          ],
          [
            "BA-43",
            t(
              "Plain language status descriptions",
              "Descriptions d’état en langage clair",
            ),
            "3",
            "Léa",
          ],
          [
            "BA-44",
            t(
              "Connect to the case management API",
              "Connexion à l’API de gestion des dossiers",
            ),
            "8",
            "Sam",
          ],
          [
            "BA-45",
            t(
              "Accessibility testing of the status page",
              "Tests d’accessibilité de la page d’état",
            ),
            "3",
            "Alex",
          ],
          [
            "BA-46",
            t(
              "Usability test with 5 applicants",
              "Test d’utilisabilité avec 5 demandeurs",
            ),
            "5",
            "Léa",
          ],
          ["", t("Total committed", "Total engagé"), "32", ""],
        ],
        {
          columnWidths: [120, 620, 140, 180],
          h: 420,
          rowHeights: [40, 55, 55, 55, 55, 55, 55, 50],
        },
      );
      k.card(
        20,
        1000,
        1060,
        40,
        t(
          "Stop when the total reaches the team’s capacity. Leave stretch items in the backlog.",
          "Arrêtez-vous quand le total atteint la capacité. Laissez les éléments facultatifs dans le carnet.",
        ),
        { color: PALETTE.grey, fontSize: 14, textAlign: "left" },
      );
      k.frame(
        1140,
        500,
        620,
        260,
        t("4. Risks and dependencies", "4. Risques et dépendances"),
      );
      k.note(
        1160,
        560,
        t(
          "Case management API test access not confirmed",
          "Accès de test à l’API non confirmé",
        ),
        { w: 280, h: 160, color: PALETTE.orange },
      );
      k.note(
        1460,
        560,
        t(
          "Léa is off on Friday of week 2",
          "Léa est absente le vendredi de la semaine 2",
        ),
        { w: 280, h: 160, color: PALETTE.orange },
      );
      k.frame(
        1140,
        800,
        620,
        260,
        t("Definition of done", "Définition de terminé"),
      );
      k.card(
        1160,
        860,
        580,
        180,
        t(
          "Code reviewed and merged\nAutomated tests pass\nWCAG 2.1 AA checked\nContent available in English and French\nProduct owner accepted",
          "Code révisé et fusionné\nTests automatisés réussis\nConformité WCAG 2.1 AA vérifiée\nContenu en français et en anglais\nAccepté par la responsable du produit",
        ),
        { textAlign: "left" },
      );
    },
  },
  {
    id: "retro",
    category: "agile",
    name: ["Sprint retrospective", "Rétrospective de sprint"],
    description: [
      "Reflect, learn, and commit to improvements.",
      "Réfléchir, apprendre et choisir des améliorations.",
    ],
    keywords: [
      "retrospective retro sprint lessons",
      "rétrospective rétro sprint leçons",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1220,
        t("Sprint retrospective", "Rétrospective de sprint"),
        t(
          "Take 5 minutes of silent writing per column, read the notes aloud, group them, then agree on one or two actions with an owner.",
          "Prenez 5 minutes d’écriture en silence par colonne, lisez les notes à voix haute, regroupez-les, puis choisissez une ou deux actions avec un responsable.",
        ),
      );
      retroBoard(
        k,
        [
          {
            title: t("What went well", "Ce qui a bien fonctionné"),
            prompt: t(
              "What should we celebrate?",
              "Que devrions-nous célébrer?",
            ),
            color: PALETTE.green,
            examples: [
              t(
                "We shipped the status page early",
                "Page d’état livrée en avance",
              ),
              t(
                "Great support from the policy team",
                "Excellent soutien de l’équipe des politiques",
              ),
            ],
          },
          {
            title: t("What was difficult", "Ce qui a été difficile"),
            prompt: t("What got in our way?", "Qu’est-ce qui nous a nui?"),
            color: PALETTE.orange,
            examples: [
              t(
                "Test environment was down for two days",
                "Environnement de test en panne deux jours",
              ),
              t("Too many urgent requests", "Trop de demandes urgentes"),
            ],
          },
          {
            title: t("What to try", "À essayer"),
            prompt: t(
              "What experiment could help?",
              "Quelle expérience pourrait aider?",
            ),
            color: PALETTE.blue,
            examples: [
              t(
                "A weekly intake slot for urgent requests",
                "Un créneau hebdomadaire pour les demandes urgentes",
              ),
              t("Shared test data set", "Jeu de données de test commun"),
            ],
          },
        ],
        actionRow(
          k,
          "Agree on an intake slot with the program team",
          "Convenir d’un créneau d’accueil avec l’équipe du programme",
        ),
      );
    },
  },
  {
    id: "retro-ssc",
    category: "agile",
    name: ["Start, Stop, Continue", "Commencer, arrêter, continuer"],
    description: [
      "A quick retrospective that turns reflection into clear changes.",
      "Une rétrospective rapide qui transforme la réflexion en changements clairs.",
    ],
    keywords: ["retrospective retro sprint", "rétrospective rétro sprint"],
    build(k) {
      const { t } = k;
      intro(
        k,
        1220,
        t("Start, Stop, Continue", "Commencer, arrêter, continuer"),
        t(
          "Reflect on the last sprint. Write one idea per sticky note, group similar notes, then dot-vote the changes to act on.",
          "Réfléchissez au dernier sprint. Écrivez une idée par note, regroupez les notes semblables, puis votez pour les changements à mettre en œuvre.",
        ),
      );
      retroBoard(
        k,
        [
          {
            title: t("Start", "Commencer"),
            prompt: t(
              "What should we begin doing?",
              "Que devrions-nous commencer à faire?",
            ),
            color: PALETTE.green,
            examples: [
              t(
                "Pair on complex stories",
                "Travailler en binôme sur les récits complexes",
              ),
              t(
                "Demo work in progress midweek",
                "Présenter le travail en cours à mi-sprint",
              ),
            ],
          },
          {
            title: t("Stop", "Arrêter"),
            prompt: t(
              "What is slowing us down?",
              "Qu’est-ce qui nous ralentit?",
            ),
            color: PALETTE.orange,
            examples: [
              t(
                "Starting new work before finishing",
                "Commencer du travail avant de finir le reste",
              ),
              t(
                "Meetings without an agenda",
                "Les réunions sans ordre du jour",
              ),
            ],
          },
          {
            title: t("Continue", "Continuer"),
            prompt: t(
              "What is working well?",
              "Qu’est-ce qui fonctionne bien?",
            ),
            color: PALETTE.blue,
            examples: [
              t(
                "Daily stand-up in 15 minutes",
                "Mêlée quotidienne en 15 minutes",
              ),
              t("Clear acceptance criteria", "Critères d’acceptation clairs"),
            ],
          },
        ],
        actionRow(
          k,
          "Book a pairing slot for each complex story",
          "Réserver un créneau de binôme pour chaque récit complexe",
        ),
      );
    },
  },
  {
    id: "retro-msg",
    category: "agile",
    name: ["Mad, Sad, Glad", "Fâché, triste, content"],
    description: [
      "An emotion-based retrospective that surfaces how the team really feels.",
      "Une rétrospective axée sur les émotions pour savoir comment l’équipe se sent vraiment.",
    ],
    keywords: [
      "retrospective retro emotions feelings",
      "rétrospective rétro émotions sentiments",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1220,
        t("Mad, Sad, Glad", "Fâché, triste, content"),
        t(
          "Invite everyone to share feelings about the sprint, not just facts. Look for patterns across columns, then pick what to change.",
          "Invitez chacun à exprimer ses émotions sur le sprint, pas seulement des faits. Cherchez les tendances entre les colonnes, puis choisissez quoi changer.",
        ),
      );
      retroBoard(
        k,
        [
          {
            title: t("Mad", "Fâché"),
            prompt: t("What frustrated you?", "Qu’est-ce qui vous a frustré?"),
            color: PALETTE.orange,
            mood: "emotion-low",
            examples: [
              t(
                "Requirements changed mid-sprint",
                "Exigences modifiées en plein sprint",
              ),
              t(
                "Builds failed without alerts",
                "Échecs de compilation sans alerte",
              ),
            ],
          },
          {
            title: t("Sad", "Triste"),
            prompt: t("What disappointed you?", "Qu’est-ce qui vous a déçu?"),
            color: PALETTE.blue,
            mood: "emotion-neutral",
            examples: [
              t(
                "We dropped the usability test",
                "Test d’utilisabilité abandonné",
              ),
              t("Little time with users", "Peu de temps avec les usagers"),
            ],
          },
          {
            title: t("Glad", "Content"),
            prompt: t(
              "What made you happy?",
              "Qu’est-ce qui vous a rendu heureux?",
            ),
            color: PALETTE.green,
            mood: "emotion-high",
            examples: [
              t(
                "Positive feedback from applicants",
                "Commentaires positifs des demandeurs",
              ),
              t(
                "New teammate onboarded fast",
                "Intégration rapide d’une nouvelle collègue",
              ),
            ],
          },
        ],
        actionRow(
          k,
          "Freeze scope after sprint planning unless the product owner agrees",
          "Geler la portée après la planification sauf accord de la responsable du produit",
        ),
      );
    },
  },
  {
    id: "retro-4ls",
    category: "agile",
    name: ["4Ls retrospective", "Rétrospective 4L"],
    description: [
      "Liked, Learned, Lacked, Longed for: a balanced look back.",
      "Aimé, appris, manqué, aspiré : un regard équilibré sur le sprint.",
    ],
    keywords: [
      "4ls liked learned lacked longed retrospective",
      "4l 4a aimé appris manqué aspiré rétrospective",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1640,
        t("4Ls retrospective", "Rétrospective 4L"),
        t(
          "Fill the four columns in silence for 8 minutes, then discuss each column. Turn the strongest themes into actions.",
          "Remplissez les quatre colonnes en silence pendant 8 minutes, puis discutez de chaque colonne. Transformez les thèmes forts en actions.",
        ),
      );
      retroBoard(
        k,
        [
          {
            title: t("Liked", "Aimé"),
            prompt: t("What did you enjoy?", "Qu’avez-vous apprécié?"),
            color: PALETTE.green,
            examples: [
              t(
                "Working sessions with the program team",
                "Séances de travail avec l’équipe du programme",
              ),
              t("Quick code reviews", "Révisions de code rapides"),
            ],
          },
          {
            title: t("Learned", "Appris"),
            prompt: t("What did you discover?", "Qu’avez-vous découvert?"),
            color: PALETTE.blue,
            examples: [
              t(
                "Screen reader testing early saves time",
                "Tester tôt avec un lecteur d’écran fait gagner du temps",
              ),
              t(
                "How the case system handles appeals",
                "Comment le système gère les appels",
              ),
            ],
          },
          {
            title: t("Lacked", "Manqué"),
            prompt: t("What was missing?", "Qu’est-ce qui a manqué?"),
            color: PALETTE.orange,
            examples: [
              t(
                "Clear priorities from leadership",
                "Priorités claires de la direction",
              ),
              t("Realistic test data", "Données de test réalistes"),
            ],
          },
          {
            title: t("Longed for", "Aspiré"),
            prompt: t(
              "What do you wish we had?",
              "Que souhaiteriez-vous avoir?",
            ),
            color: PALETTE.purple,
            examples: [
              t(
                "More time with real users",
                "Plus de temps avec de vrais usagers",
              ),
              t("A shared design system", "Un système de design commun"),
            ],
          },
        ],
        actionRow(
          k,
          "Ask leadership for a ranked list of priorities before sprint planning",
          "Demander à la direction une liste de priorités classées avant la planification",
        ),
      );
    },
  },
  {
    id: "retro-sailboat",
    category: "agile",
    name: ["Sailboat retrospective", "Rétrospective du voilier"],
    description: [
      "Use a sailing metaphor to find what drives, slows, and threatens the team.",
      "Une métaphore de voile pour trouver ce qui propulse, freine et menace l’équipe.",
    ],
    keywords: [
      "sailboat retrospective wind anchor rocks island metaphor",
      "voilier rétrospective vent ancre rochers île métaphore",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1520,
        t("Sailboat retrospective", "Rétrospective du voilier"),
        t(
          "The boat is the team and the island is our goal. Add notes to each zone below: what pushes us forward, what holds us back, and what risks lie ahead.",
          "Le bateau représente l’équipe et l’île, notre objectif. Ajoutez des notes dans chaque zone : ce qui nous propulse, ce qui nous retient et les risques à venir.",
        ),
      );
      k.frame(0, 140, 1520, 520, t("The journey", "Le voyage"));
      const wind = k.shape("cloud", 60, 220, 280, 160, t("Wind", "Vent"), {
        color: PALETTE.blue,
        fontSize: 22,
      });
      const sail = k.shape("triangle", 580, 220, 200, 240, "", {
        color: PALETTE.white,
      });
      k.connect(wind, sail, { lineStyle: "dashed", color: PALETTE.muted });
      k.shape(
        "manual-operation",
        500,
        460,
        360,
        80,
        t("Our team", "Notre équipe"),
        {
          color: PALETTE.orange,
          fontSize: 20,
        },
      );
      k.line(20, 540, 1500, 540, { color: PALETTE.emphasis, lineWidth: 3 });
      k.line(680, 540, 680, 580, { color: PALETTE.emphasis, lineWidth: 2 });
      k.card(580, 580, 200, 60, t("Anchors", "Ancres"), {
        color: PALETTE.grey,
        fontSize: 18,
        textAlign: "center",
      });
      k.shape("triangle", 960, 460, 140, 100, t("Rocks", "Rochers"), {
        color: PALETTE.grey,
      });
      k.shape("triangle", 1080, 500, 80, 60, "", { color: PALETTE.grey });
      k.shape("star", 1300, 240, 100, 100, "", { color: PALETTE.yellow });
      k.shape(
        "ellipse",
        1200,
        360,
        300,
        160,
        t("Island: our goal", "Île : notre objectif"),
        {
          color: PALETTE.green,
          fontSize: 20,
        },
      );
      const zones = [
        [
          t(
            "Wind: what pushes us forward?",
            "Vent : qu’est-ce qui nous propulse?",
          ),
          PALETTE.blue,
          [
            t(
              "Strong support from the director",
              "Solide appui de la directrice",
            ),
            t("Automated deployments", "Déploiements automatisés"),
          ],
        ],
        [
          t(
            "Anchors: what holds us back?",
            "Ancres : qu’est-ce qui nous retient?",
          ),
          PALETTE.grey,
          [
            t(
              "Manual approvals for each release",
              "Approbations manuelles à chaque version",
            ),
            t("Legacy database access", "Accès à l’ancienne base de données"),
          ],
        ],
        [
          t(
            "Rocks: what risks lie ahead?",
            "Rochers : quels risques nous guettent?",
          ),
          PALETTE.orange,
          [
            t("Contract renewal in June", "Renouvellement du contrat en juin"),
            t("Peak season traffic", "Trafic de haute saison"),
          ],
        ],
        [
          t("Island: where are we going?", "Île : où allons-nous?"),
          PALETTE.green,
          [
            t(
              "Launch the online service to all provinces",
              "Lancer le service en ligne dans toutes les provinces",
            ),
            t(
              "Halve the calls to the contact centre",
              "Réduire de moitié les appels",
            ),
          ],
        ],
      ];
      zones.forEach(([title, color, notes], n) => {
        const x = n * 390;
        k.frame(x, 700, 350, 440, title);
        notes.forEach((text, r) =>
          k.note(x + 20, 780 + r * 160, text, { w: 310, h: 140, color }),
        );
      });
    },
  },
  {
    id: "daily-standup",
    category: "agile",
    name: ["Daily stand-up", "Mêlée quotidienne"],
    description: [
      "Run a focused 15-minute stand-up with blockers and a parking lot.",
      "Animer une mêlée de 15 minutes axée sur les obstacles, avec une zone d’attente.",
    ],
    keywords: [
      "daily standup scrum blockers parking lot burndown",
      "mêlée quotidienne scrum obstacles stationnement burndown",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1620,
        t("Daily stand-up", "Mêlée quotidienne"),
        t(
          "Go around the team once. Keep updates short and focused on the sprint goal; move discussions to the parking lot and solve blockers right after.",
          "Faites un seul tour de l’équipe. Gardez les mises à jour brèves et centrées sur l’objectif du sprint; déplacez les discussions dans la zone d’attente.",
        ),
      );
      k.frame(
        0,
        140,
        1180,
        420,
        t("Round the team · 15 min", "Tour de l’équipe · 15 min"),
      );
      k.table(
        20,
        200,
        1140,
        [
          [
            t("Person", "Personne"),
            t("Yesterday", "Hier"),
            t("Today", "Aujourd’hui"),
            t("Blockers", "Obstacles"),
          ],
          [
            "Priya",
            t(
              "Finished the status page layout",
              "Terminé la mise en page de l’état",
            ),
            t("Connect it to the API", "La relier à l’API"),
            t("Need API test keys", "Besoin des clés de test de l’API"),
          ],
          [
            "Sam",
            t("Email template reviewed", "Modèle de courriel révisé"),
            t("French version of the email", "Version française du courriel"),
            t("None", "Aucun"),
          ],
          [
            "Léa",
            t("Usability test script", "Scénario de test d’utilisabilité"),
            t("Recruit 5 participants", "Recruter 5 participants"),
            t("None", "Aucun"),
          ],
          [
            "Alex",
            t("Regression tests", "Tests de régression"),
            t("Accessibility checks", "Vérifications d’accessibilité"),
            "",
          ],
          ["", "", "", ""],
        ],
        {
          columnWidths: [180, 320, 320, 320],
          h: 340,
          rowHeights: [40, 60, 60, 60, 60, 60],
        },
      );
      k.frame(1220, 140, 400, 420, t("Parking lot", "Zone d’attente"));
      k.note(
        1240,
        200,
        t(
          "Who approves the new email wording?",
          "Qui approuve le nouveau libellé du courriel?",
        ),
        {
          w: 360,
          h: 140,
          color: PALETTE.purple,
        },
      );
      k.note(
        1240,
        360,
        t(
          "Discuss after: test data refresh",
          "À discuter ensuite : données de test",
        ),
        {
          w: 360,
          h: 140,
          color: PALETTE.purple,
        },
      );
      k.frame(
        0,
        600,
        1180,
        420,
        t("Sprint burndown", "Graphique d’avancement du sprint"),
      );
      k.line(80, 940, 80, 680, { endCap: "arrow", color: PALETTE.muted });
      k.line(80, 940, 1140, 940, { endCap: "arrow", color: PALETTE.muted });
      k.line(80, 680, 1120, 940, { lineStyle: "dashed", color: PALETTE.muted });
      const remaining = [40, 38, 35, 35, 30, 26, 24];
      remaining.forEach((value, n) => {
        if (!n) return;
        k.line(
          80 + (n - 1) * 104,
          940 - remaining[n - 1] * 6.5,
          80 + n * 104,
          940 - value * 6.5,
          { color: PALETTE.emphasis, lineWidth: 3 },
        );
      });
      k.text(20, 650, 400, t("Points remaining", "Points restants"), {
        fontSize: 14,
      });
      k.text(900, 960, 240, t("Sprint days", "Jours du sprint"), {
        fontSize: 14,
        textAlign: "right",
      });
      k.card(
        700,
        660,
        460,
        80,
        t(
          "Dashed line: ideal pace. Solid line: actual points left. Update it after each stand-up.",
          "Ligne pointillée : rythme idéal. Ligne pleine : points restants. Mettez-la à jour après chaque mêlée.",
        ),
        { color: PALETTE.grey, fontSize: 14, textAlign: "left" },
      );
      k.frame(
        1220,
        600,
        400,
        420,
        t("Stand-up reminders", "Rappels pour la mêlée"),
      );
      k.card(
        1240,
        660,
        360,
        120,
        t(
          "Sprint goal: applicants can track their application online.",
          "Objectif : les demandeurs peuvent suivre leur demande en ligne.",
        ),
        { color: PALETTE.navy, textColor: "#ffffff", textAlign: "left" },
      );
      k.card(
        1240,
        800,
        360,
        200,
        t(
          "Same time, same place, 15 minutes\nTalk about the work, not the hours\nRaise blockers early\nSolve problems after the stand-up",
          "Même heure, même endroit, 15 minutes\nParlez du travail, pas des heures\nSignalez les obstacles tôt\nRéglez les problèmes après la mêlée",
        ),
        { textAlign: "left" },
      );
    },
  },
  {
    id: "backlog-refinement",
    category: "agile",
    name: ["Backlog refinement", "Affinage du carnet"],
    description: [
      "Get stories ready with acceptance criteria, estimates, and splits.",
      "Préparer les récits avec des critères d’acceptation, des estimations et des découpages.",
    ],
    keywords: [
      "backlog refinement grooming definition of ready acceptance criteria estimation",
      "affinage carnet définition de prêt critères d’acceptation estimation",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1440,
        t("Backlog refinement", "Affinage du carnet"),
        t(
          "Bring the top stories, write acceptance criteria together, estimate with the whole team, and split anything too big to finish in one sprint.",
          "Apportez les récits prioritaires, rédigez ensemble les critères d’acceptation, estimez en équipe et découpez ce qui est trop gros pour un sprint.",
        ),
      );
      k.frame(0, 140, 420, 520, t("Definition of ready", "Définition de prêt"));
      [
        t("Written as a user story", "Rédigé comme un récit utilisateur"),
        t("Clear value for users", "Valeur claire pour les usagers"),
        t("Acceptance criteria agreed", "Critères d’acceptation convenus"),
        t("Dependencies identified", "Dépendances connues"),
        t("Estimated by the team", "Estimé par l’équipe"),
        t("Small enough for one sprint", "Assez petit pour un sprint"),
        t("Content in both languages", "Contenu dans les deux langues"),
      ].forEach((text, n) =>
        k.shape("wf-checkbox", 20, 200 + n * 60, 380, 40, text, {
          textAlign: "left",
          fontSize: 16,
        }),
      );
      k.frame(460, 140, 980, 520, t("Stories to refine", "Récits à affiner"));
      [
        [
          t(
            "As an applicant, I want to upload proof of address so that my application is complete.",
            "En tant que demandeur, je veux téléverser une preuve d’adresse pour que ma demande soit complète.",
          ),
          t(
            "Given I am on the documents step\nWhen I upload a PDF or photo under 10 MB\nThen I see it listed with a remove option\nAnd an error explains other file types",
            "Étant donné que je suis à l’étape des documents\nLorsque je téléverse un PDF ou une photo de moins de 10 Mo\nAlors je le vois dans la liste avec une option de retrait\nEt une erreur explique les autres formats",
          ),
          t("Estimate: 5 points", "Estimation : 5 points"),
        ],
        [
          t(
            "As an agent, I want to see missing documents so that I can contact the applicant.",
            "En tant qu’agent, je veux voir les documents manquants pour communiquer avec le demandeur.",
          ),
          t(
            "Given an application is missing a document\nWhen I open the case\nThen a banner lists the missing documents\nAnd I can send a reminder",
            "Étant donné qu’il manque un document\nLorsque j’ouvre le dossier\nAlors une bannière liste les documents manquants\nEt je peux envoyer un rappel",
          ),
          t("Estimate: 8 points", "Estimation : 8 points"),
        ],
      ].forEach(([story, criteria, estimate], n) => {
        const x = 480 + n * 480;
        k.note(x, 200, story, { w: 460, h: 120 });
        k.card(x, 340, 460, 200, criteria, { textAlign: "left", fontSize: 14 });
        k.card(x, 560, 200, 60, estimate, {
          color: PALETTE.blue,
          textAlign: "center",
        });
      });
      k.frame(0, 700, 720, 280, t("Estimation scale", "Échelle d’estimation"));
      ["1", "2", "3", "5", "8", "13", "?"].forEach((value, n) =>
        k.shape("ellipse", 20 + n * 100, 760, 80, 80, value, {
          color: n > 4 ? PALETTE.orange : PALETTE.green,
          fontSize: 24,
        }),
      );
      k.card(
        20,
        860,
        680,
        100,
        t(
          "Points compare effort, complexity, and uncertainty, not hours. Anything above 8 is a split candidate. “?” means we need a spike first.",
          "Les points comparent l’effort, la complexité et l’incertitude, pas les heures. Au-delà de 8, il faut découper. « ? » signifie qu’une exploration est nécessaire.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
      k.frame(760, 700, 680, 280, t("Split candidates", "Récits à découper"));
      k.note(
        780,
        760,
        t(
          "Upload documents from a phone camera (13 pts)",
          "Téléverser des documents avec l’appareil photo (13 pts)",
        ),
        {
          w: 200,
          h: 140,
          color: PALETTE.orange,
        },
      );
      k.note(
        1000,
        760,
        t(
          "Online payment of fees (13 pts)",
          "Paiement en ligne des frais (13 pts)",
        ),
        {
          w: 200,
          h: 140,
          color: PALETTE.orange,
        },
      );
      k.card(
        1220,
        760,
        200,
        200,
        t(
          "Split by workflow step, business rule, data type, or happy path first.",
          "Découpez par étape, règle d’affaires, type de données ou cas nominal d’abord.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
    },
  },
  {
    id: "user-story-map",
    category: "agile",
    name: ["User story map", "Carte des récits utilisateurs"],
    description: [
      "Lay out the user journey and slice it into releases.",
      "Représenter le parcours de l’usager et le découper en versions.",
    ],
    keywords: [
      "story mapping backbone release slices mvp journey",
      "cartographie des récits épine dorsale versions produit minimal parcours",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1820,
        t("User story map", "Carte des récits utilisateurs"),
        t(
          "Read left to right as the user’s journey. Activities form the backbone, tasks sit under them, and stories are sliced into releases: the top slice is the smallest service that works end to end.",
          "Lisez de gauche à droite comme le parcours de l’usager. Les activités forment l’épine dorsale, les tâches sont en dessous et les récits sont découpés en versions : la tranche du haut est le plus petit service utile de bout en bout.",
        ),
      );
      k.frame(
        0,
        160,
        1820,
        840,
        t(
          "Benefits application story map",
          "Carte des récits : demande de prestations",
        ),
      );
      const label = (y, h, text, color = PALETTE.grey) =>
        k.card(20, y, 180, h, text, { color, textAlign: "left", fontSize: 16 });
      label(220, 80, t("Activities", "Activités"), PALETTE.blue);
      label(320, 100, t("User tasks", "Tâches"), PALETTE.yellow);
      label(
        470,
        220,
        t(
          "Release 1: minimum viable service",
          "Version 1 : service minimal viable",
        ),
      );
      label(730, 100, t("Release 2", "Version 2"));
      label(870, 100, t("Later", "Plus tard"));
      const activities = [
        t("Check eligibility", "Vérifier l’admissibilité"),
        t("Apply", "Présenter une demande"),
        t("Track status", "Suivre l’état"),
        t("Receive payment", "Recevoir le paiement"),
      ];
      activities.forEach((text, n) =>
        k.card(220 + n * 400, 220, 380, 80, text, {
          color: PALETTE.blue,
          fontSize: 20,
          textAlign: "center",
        }),
      );
      const tasks = [
        t("Read the criteria", "Lire les critères"),
        t("Answer questions", "Répondre aux questions"),
        t("Enter details", "Saisir les renseignements"),
        t("Upload documents", "Téléverser les documents"),
        t("See the current step", "Voir l’étape actuelle"),
        t("Get notified", "Être avisé"),
        t("Set up direct deposit", "Configurer le dépôt direct"),
        t("View payments", "Voir les paiements"),
      ];
      tasks.forEach((text, n) =>
        k.note(220 + n * 200, 320, text, {
          w: 180,
          h: 100,
          color: PALETTE.yellow,
        }),
      );
      const stories = [
        [
          0,
          470,
          t("One page of plain criteria", "Une page de critères clairs"),
        ],
        [1, 470, t("5 yes or no questions", "5 questions oui ou non")],
        [2, 470, t("Name, address, SIN", "Nom, adresse, NAS")],
        [3, 470, t("Upload a PDF", "Téléverser un PDF")],
        [
          4,
          470,
          t(
            "Status: received, in review, decided",
            "État : reçue, en examen, décidée",
          ),
        ],
        [6, 470, t("Enter bank details", "Saisir les coordonnées bancaires")],
        [2, 590, t("Save and resume", "Enregistrer et reprendre")],
        [5, 590, t("Email on decision", "Courriel à la décision")],
        [7, 590, t("Payment date shown", "Date de paiement affichée")],
        [1, 730, t("Estimate the benefit amount", "Estimer le montant")],
        [3, 730, t("Photo from phone", "Photo depuis le téléphone")],
        [5, 730, t("Text message alerts", "Alertes par texto")],
        [7, 730, t("Payment history", "Historique des paiements")],
        [0, 870, t("Video explainer", "Vidéo explicative")],
        [4, 870, t("Expected decision date", "Date de décision prévue")],
        [
          6,
          870,
          t("Change banking details", "Modifier les coordonnées bancaires"),
        ],
      ];
      stories.forEach(([column, y, text]) =>
        k.note(220 + column * 200, y, text, {
          w: 180,
          h: 100,
          color:
            y < 700 ? PALETTE.green : y < 840 ? PALETTE.blue : PALETTE.purple,
        }),
      );
      for (const y of [450, 710, 850])
        k.line(20, y, 1800, y, { lineStyle: "dashed", color: PALETTE.muted });
    },
  },
];
