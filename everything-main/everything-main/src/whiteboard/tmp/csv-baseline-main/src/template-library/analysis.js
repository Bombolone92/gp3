import { PALETTE } from "./kit.js";
const r10 = (n) => Math.round(n / 10) * 10;
// Tables take their height from explicit row heights.
const table = (k, x, y, w, cells, columnWidths, rowHeights) =>
  k.table(x, y, w, cells, {
    columnWidths,
    ...(rowHeights
      ? { rowHeights, h: rowHeights.reduce((a, b) => a + b, 0) }
      : {}),
  });
export default [
  {
    id: "affinity-map",
    category: "analysis",
    name: ["Affinity mapping", "Schéma d’affinités"],
    description: [
      "Cluster research notes into themes and draw out insights.",
      "Regrouper les notes de recherche en thèmes et en dégager des constats.",
    ],
    keywords: [
      "affinity diagram clustering synthesis research themes",
      "diagramme d’affinités regroupement synthèse recherche thèmes",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1240, t("Affinity mapping", "Schéma d’affinités"));
      k.text(
        0,
        60,
        1240,
        t(
          "1. Add one observation per note in Raw notes. 2. Move similar notes together silently. 3. Name each cluster with a header card. 4. Write what each theme means in Insights.",
          "1. Ajoutez une observation par note dans Notes brutes. 2. Rapprochez les notes semblables en silence. 3. Nommez chaque groupe avec une carte d’en-tête. 4. Formulez ce que chaque thème signifie dans Constats.",
        ),
      );
      k.frame(0, 140, 580, 700, t("1 · Raw notes", "1 · Notes brutes"));
      const raw = [
        t(
          "“I didn’t know which form to use.”",
          "« Je ne savais pas quel formulaire utiliser. »",
        ),
        t(
          "Called twice to check status",
          "A appelé deux fois pour connaître l’état",
        ),
        t("Uploaded the wrong document", "A téléversé le mauvais document"),
        t(
          "Liked the email confirmation",
          "A aimé la confirmation par courriel",
        ),
        t(
          "Unsure about eligibility rules",
          "Incertain des règles d’admissibilité",
        ),
        t(
          "Could not sign in on mobile",
          "Impossible de se connecter sur mobile",
        ),
        t("Asked a friend for help", "A demandé de l’aide à un ami"),
        t("Page timed out while typing", "La page a expiré pendant la saisie"),
        t(
          "Wanted a clear processing date",
          "Voulait une date de traitement claire",
        ),
        t("Add an observation", "Ajoutez une observation"),
        t("Add an observation", "Ajoutez une observation"),
        t("Add an observation", "Ajoutez une observation"),
      ];
      raw.forEach((text, n) =>
        k.note(20 + (n % 3) * 180, 200 + Math.floor(n / 3) * 150, text, {
          w: 160,
          h: 130,
          color: n > 8 ? PALETTE.grey : PALETTE.yellow,
        }),
      );
      k.frame(620, 140, 620, 700, t("2 · Themes", "2 · Thèmes"));
      const themes = [
        [
          t("Finding the right path", "Trouver le bon chemin"),
          PALETTE.blue,
          [
            t(
              "Didn’t know which form to use",
              "Ne savait pas quel formulaire utiliser",
            ),
            t("Unsure about eligibility", "Incertain de l’admissibilité"),
            t("Asked a friend for help", "A demandé de l’aide à un ami"),
          ],
        ],
        [
          t("Technical friction", "Obstacles techniques"),
          PALETTE.orange,
          [
            t("Could not sign in on mobile", "Connexion impossible sur mobile"),
            t("Page timed out", "La page a expiré"),
            t("Uploaded the wrong file", "Mauvais fichier téléversé"),
          ],
        ],
        [
          t("Knowing what happens next", "Savoir ce qui se passe ensuite"),
          PALETTE.green,
          [
            t("Called twice for status", "A appelé deux fois"),
            t("Wanted a clear date", "Voulait une date claire"),
            t("Liked the confirmation", "A aimé la confirmation"),
          ],
        ],
      ];
      themes.forEach(([title, color, notes], n) => {
        const x = 640 + n * 200;
        k.shape("terminator", x, 200, 180, 60, title, {
          color: PALETTE.grey,
          bold: true,
        });
        notes.forEach((text, e) =>
          k.note(x, 280 + e * 140, text, { w: 180, h: 120, color }),
        );
      });
      k.frame(0, 880, 1240, 260, t("3 · Insights", "3 · Constats"));
      const insights = [
        t(
          "People need help choosing the right service before they start.",
          "Les gens ont besoin d’aide pour choisir le bon service avant de commencer.",
        ),
        t(
          "Mobile sign-in and time-outs cause people to abandon their application.",
          "La connexion mobile et les délais d’expiration font abandonner les demandes.",
        ),
        t(
          "Uncertainty after submitting drives repeat calls.",
          "L’incertitude après l’envoi entraîne des appels répétés.",
        ),
      ];
      insights.forEach((text, n) =>
        k.card(20 + n * 410, 940, 380, 140, text, {
          color: PALETTE.purple,
          fontSize: 18,
        }),
      );
    },
  },
  {
    id: "fishbone",
    category: "analysis",
    name: ["Fishbone diagram", "Diagramme d’Ishikawa"],
    description: [
      "Trace a problem back to its causes across six categories.",
      "Remonter aux causes d’un problème selon six catégories.",
    ],
    keywords: [
      "ishikawa cause and effect root cause analysis",
      "arête de poisson cause à effet analyse des causes profondes",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1600, t("Fishbone diagram", "Diagramme d’Ishikawa"));
      k.text(
        0,
        60,
        1600,
        t(
          "Write the problem in the head. For each category, ask “Why does this happen?” and add causes along the bone. Circle the causes with the most evidence and carry them into the table.",
          "Inscrivez le problème dans la tête. Pour chaque catégorie, demandez « Pourquoi cela se produit-il? » et ajoutez les causes le long de l’arête. Retenez les causes les mieux appuyées et reportez-les dans le tableau.",
        ),
      );
      k.frame(0, 140, 1600, 820, t("Causes", "Causes"));
      const spine = 550;
      k.line(60, spine, 1340, spine, {
        lineWidth: 4,
        endCap: "arrow",
        color: PALETTE.muted,
      });
      k.shape(
        "rectangle",
        1360,
        460,
        220,
        180,
        t(
          "Problem: applications take 12 weeks to process",
          "Problème : le traitement des demandes prend 12 semaines",
        ),
        { color: PALETTE.orange, fontSize: 18, bold: true },
      );
      const bones = [
        [
          t("People", "Personnes"),
          [
            t("Staff turnover", "Roulement du personnel"),
            t("Training takes months", "La formation prend des mois"),
          ],
        ],
        [
          t("Process", "Processus"),
          [
            t("Manual data re-entry", "Saisie manuelle répétée"),
            t("Three approval steps", "Trois étapes d’approbation"),
          ],
        ],
        [
          t("Technology", "Technologie"),
          [
            t("Legacy case system", "Ancien système de gestion des cas"),
            t("No online status", "Aucun suivi en ligne"),
          ],
        ],
        [
          t("Policy", "Politiques"),
          [
            t("Complex eligibility rules", "Règles d’admissibilité complexes"),
            t("Wet signature required", "Signature manuscrite exigée"),
          ],
        ],
        [
          t("Data", "Données"),
          [
            t("Missing documents", "Documents manquants"),
            t("Duplicate client records", "Dossiers clients en double"),
          ],
        ],
        [
          t("Environment", "Environnement"),
          [
            t("Seasonal peaks in demand", "Pics saisonniers de la demande"),
            t(
              "Offices in several time zones",
              "Bureaux dans plusieurs fuseaux horaires",
            ),
          ],
        ],
      ];
      bones.forEach(([label, causes], n) => {
        const join = 460 + (n % 3) * 400,
          top = n < 3,
          edgeY = top ? 250 : 850,
          startX = join - 220;
        k.shape("terminator", join - 340, top ? 200 : 850, 240, 50, label, {
          color: PALETTE.blue,
          bold: true,
        });
        k.line(startX, edgeY, join, spine, {
          lineWidth: 3,
          color: PALETTE.muted,
        });
        causes.forEach((text, c) => {
          const along = c ? 0.7 : 0.3,
            y = edgeY + (spine - edgeY) * along,
            x = startX + 220 * along;
          k.note(r10(x - 180), r10(y - 40), text, {
            w: 160,
            h: 80,
            color: PALETTE.yellow,
          });
        });
      });
      k.frame(
        0,
        1000,
        1600,
        300,
        t("Most likely causes", "Causes les plus probables"),
      );
      table(
        k,
        20,
        1060,
        1560,
        [
          [
            t("Cause", "Cause"),
            t("Category", "Catégorie"),
            t("Evidence", "Données probantes"),
            t("Next step", "Prochaine étape"),
            t("Owner", "Responsable"),
          ],
          [
            t("Manual data re-entry", "Saisie manuelle répétée"),
            t("Process", "Processus"),
            t(
              "40% of handling time in time study",
              "40 % du temps de traitement selon l’étude",
            ),
            t(
              "Prototype a digital intake form",
              "Prototyper un formulaire d’accueil numérique",
            ),
            t("Operations lead", "Direction des opérations"),
          ],
          [
            t("Missing documents", "Documents manquants"),
            t("Data", "Données"),
            t("1 in 3 files returned", "1 dossier sur 3 retourné"),
            t("Add a document checklist", "Ajouter une liste de documents"),
            t("Service designer", "Concepteur de services"),
          ],
          ["", "", "", "", ""],
        ],
        [320, 200, 400, 400, 240],
        [40, 60, 60, 60],
      );
    },
  },
  {
    id: "five-whys",
    category: "analysis",
    name: ["5 whys", "Les 5 pourquoi"],
    description: [
      "Ask why five times to move from a symptom to a root cause.",
      "Demander pourquoi cinq fois pour passer du symptôme à la cause profonde.",
    ],
    keywords: [
      "five whys root cause problem solving",
      "cinq pourquoi cause profonde résolution de problèmes",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1840, t("5 whys", "Les 5 pourquoi"));
      k.text(
        0,
        60,
        1840,
        t(
          "State the problem as a fact. Ask “Why?” and write the answer in the next card, then ask why again. Stop when you reach a cause you can act on, and agree on a countermeasure.",
          "Énoncez le problème comme un fait. Demandez « Pourquoi? » et écrivez la réponse dans la carte suivante, puis redemandez pourquoi. Arrêtez-vous à une cause sur laquelle vous pouvez agir et convenez d’une contre-mesure.",
        ),
      );
      k.frame(0, 140, 320, 440, t("Problem", "Problème"));
      const problem = k.shape(
        "rectangle",
        20,
        200,
        280,
        180,
        t(
          "Clients call the contact centre to ask about their application status",
          "Les clients appellent le centre d’appels pour connaître l’état de leur demande",
        ),
        { color: PALETTE.orange, fontSize: 18 },
      );
      k.note(
        20,
        400,
        t(
          "Evidence: 12,000 status calls last month",
          "Preuve : 12 000 appels sur l’état le mois dernier",
        ),
        { w: 280, h: 140, color: PALETTE.yellow },
      );
      k.frame(
        360,
        140,
        1100,
        440,
        t("Ask why five times", "Demandez pourquoi cinq fois"),
      );
      const answers = [
        t(
          "They don’t know where their application is",
          "Ils ne savent pas où en est leur demande",
        ),
        t(
          "The status is not shown online",
          "L’état n’est pas affiché en ligne",
        ),
        t(
          "The case system cannot share status data",
          "Le système de gestion des cas ne peut pas transmettre l’état",
        ),
        t(
          "No interface was built when the system was set up",
          "Aucune interface n’a été prévue à l’installation",
        ),
        t(
          "Status updates were not seen as part of the service",
          "Le suivi n’était pas considéré comme faisant partie du service",
        ),
      ];
      let previous = problem;
      answers.forEach((text, n) => {
        const x = 380 + n * 220;
        k.shape(
          "terminator",
          x,
          200,
          180,
          40,
          t(`Why ${n + 1}?`, `Pourquoi ${n + 1}?`),
          {
            color: PALETTE.grey,
            bold: true,
          },
        );
        const card = k.shape("rectangle", x, 260, 180, 200, text, {
          color: n === 4 ? PALETTE.purple : PALETTE.blue,
        });
        k.connect(previous, card, { lineType: "straight" });
        previous = card;
      });
      k.frame(
        1500,
        140,
        340,
        440,
        t("Root cause and action", "Cause profonde et action"),
      );
      const root = k.card(
        1520,
        200,
        300,
        140,
        t(
          "Root cause: status updates were never designed into the service",
          "Cause profonde : le suivi n’a jamais été conçu dans le service",
        ),
        { color: PALETTE.purple, bold: true },
      );
      const fix = k.card(
        1520,
        380,
        300,
        140,
        t(
          "Countermeasure: publish status in the online account and send notices at each step",
          "Contre-mesure : afficher l’état dans le compte en ligne et envoyer un avis à chaque étape",
        ),
        { color: PALETTE.green },
      );
      k.connect(previous, root);
      k.connect(root, fix);
      k.frame(0, 620, 1840, 240, t("Check the chain", "Vérifiez la chaîne"));
      [
        t(
          "Read the chain backwards with “therefore”. Does each step still make sense?",
          "Relisez la chaîne à rebours avec « donc ». Chaque étape a-t-elle encore du sens?",
        ),
        t(
          "Is the root cause within your control?",
          "La cause profonde relève-t-elle de votre contrôle?",
        ),
        t(
          "How will you know the countermeasure worked?",
          "Comment saurez-vous que la contre-mesure a fonctionné?",
        ),
        t(
          "Measure: status calls down 50% in 3 months",
          "Mesure : appels sur l’état en baisse de 50 % en 3 mois",
        ),
      ].forEach((text, n) =>
        k.note(20 + n * 460, 680, text, {
          w: 420,
          h: 140,
          color: n === 3 ? PALETTE.green : PALETTE.grey,
        }),
      );
    },
  },
  {
    id: "decision-matrix",
    category: "analysis",
    name: ["Decision matrix", "Matrice de décision"],
    description: [
      "Compare options against weighted criteria and agree on a choice.",
      "Comparer des options selon des critères pondérés et convenir d’un choix.",
    ],
    keywords: [
      "weighted scoring criteria options evaluation pugh",
      "pondération notation critères options évaluation",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1720, t("Decision matrix", "Matrice de décision"));
      k.text(
        0,
        60,
        1720,
        t(
          "List the options, agree on criteria and weights (1 to 5), then score each option from 1 to 5. Multiply by the weight, add the totals, and discuss before deciding.",
          "Énumérez les options, convenez des critères et de leur poids (1 à 5), puis notez chaque option de 1 à 5. Multipliez par le poids, additionnez, et discutez avant de décider.",
        ),
      );
      k.frame(0, 140, 1240, 220, t("1 · Options", "1 · Options"));
      const options = [
        [
          t(
            "Option A: modernize the current system",
            "Option A : moderniser le système actuel",
          ),
          PALETTE.blue,
        ],
        [
          t(
            "Option B: adopt a shared platform",
            "Option B : adopter une plateforme commune",
          ),
          PALETTE.green,
        ],
        [
          t(
            "Option C: buy a commercial product",
            "Option C : acheter un produit commercial",
          ),
          PALETTE.purple,
        ],
      ];
      options.forEach(([text, color], n) =>
        k.card(20 + n * 410, 200, 380, 120, text, { color, fontSize: 18 }),
      );
      k.frame(
        0,
        400,
        1240,
        440,
        t("2 · Weighted scores", "2 · Notes pondérées"),
      );
      table(
        k,
        20,
        460,
        1200,
        [
          [
            t("Criterion", "Critère"),
            t("Weight", "Poids"),
            t("Option A (score, weighted)", "Option A (note, pondérée)"),
            t("Option B (score, weighted)", "Option B (note, pondérée)"),
            t("Option C (score, weighted)", "Option C (note, pondérée)"),
          ],
          [
            t("Meets user needs", "Répond aux besoins des utilisateurs"),
            "5",
            "3 · 15",
            "4 · 20",
            "3 · 15",
          ],
          [
            t("Cost over five years", "Coût sur cinq ans"),
            "4",
            "2 · 8",
            "4 · 16",
            "3 · 12",
          ],
          [
            t("Time to deliver", "Délai de livraison"),
            "3",
            "2 · 6",
            "4 · 12",
            "5 · 15",
          ],
          [
            t("Security and privacy", "Sécurité et confidentialité"),
            "5",
            "4 · 20",
            "4 · 20",
            "3 · 15",
          ],
          [
            t(
              "Accessibility and official languages",
              "Accessibilité et langues officielles",
            ),
            "4",
            "3 · 12",
            "5 · 20",
            "2 · 8",
          ],
          [t("Weighted total", "Total pondéré"), "", "61", "88", "65"],
          ["", "", "", "", ""],
        ],
        [360, 120, 240, 240, 240],
      );
      k.frame(1280, 140, 440, 400, t("Scoring guide", "Guide de notation"));
      table(
        k,
        1300,
        200,
        400,
        [
          [t("Score", "Note"), t("Meaning", "Signification")],
          [
            "5",
            t("Fully meets the criterion", "Répond entièrement au critère"),
          ],
          ["4", t("Mostly meets it", "Y répond en grande partie")],
          ["3", t("Partly meets it", "Y répond en partie")],
          ["2", t("Barely meets it", "Y répond à peine")],
          ["1", t("Does not meet it", "N’y répond pas")],
        ],
        [100, 300],
      );
      k.note(
        1300,
        460,
        t(
          "Weights: 5 is essential, 1 is nice to have",
          "Poids : 5 est essentiel, 1 est souhaitable",
        ),
        {
          w: 400,
          h: 60,
          color: PALETTE.grey,
        },
      );
      k.frame(
        1280,
        580,
        440,
        260,
        t("3 · Recommendation", "3 · Recommandation"),
      );
      k.card(
        1300,
        640,
        400,
        100,
        t(
          "Recommend option B: highest total and strongest on user needs.",
          "Option B recommandée : total le plus élevé et meilleure réponse aux besoins.",
        ),
        { color: PALETTE.green, bold: true },
      );
      k.note(
        1300,
        760,
        t("Decision owner: director general", "Décision : directrice générale"),
        {
          w: 400,
          h: 60,
          color: PALETTE.yellow,
        },
      );
    },
  },
];
