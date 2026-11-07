import { PALETTE } from "./kit.js";
// French number style: decimal comma, space for thousands and before %.
const frenchValue = (v) =>
  v
    .replace(/(\d),(\d{3})/, "$1 $2")
    .replace(/(\d)\.(\d)/, "$1,$2")
    .replace("%", " %")
    .replace("days", "jours");
function intro(k, w, title, subtitle) {
  k.heading(0, 0, w, title);
  k.text(0, 60, w, subtitle);
}
export default [
  {
    id: "product",
    category: "product",
    name: ["Product roadmap", "Feuille de route produit"],
    description: [
      "Connect outcomes, initiatives, and milestones in Now, Next, Later.",
      "Relier les résultats, les initiatives et les jalons : maintenant, ensuite, plus tard.",
    ],
    keywords: [
      "roadmap now next later outcomes initiatives",
      "feuille de route maintenant ensuite plus tard résultats initiatives",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1740,
        t("Product roadmap", "Feuille de route produit"),
        t(
          "Organize work by certainty, not dates. Start each column with the outcome you want, add initiatives as notes colored by theme, and say how you will measure success.",
          "Organisez le travail selon le degré de certitude plutôt que selon des dates. Commencez chaque colonne par le résultat visé, ajoutez les initiatives par thème et précisez comment mesurer la réussite.",
        ),
      );
      const columns = [
        [
          t("Now · committed", "Maintenant · engagé"),
          t(
            "Outcome: applicants finish online without help",
            "Résultat : les demandeurs terminent en ligne sans aide",
          ),
          [
            [
              t(
                "Save and resume applications",
                "Enregistrer et reprendre une demande",
              ),
              PALETTE.green,
            ],
            [
              t(
                "Plain language eligibility page",
                "Page d’admissibilité en langage clair",
              ),
              PALETTE.blue,
            ],
            [
              t(
                "Status tracking for applicants",
                "Suivi de l’état pour les demandeurs",
              ),
              PALETTE.green,
            ],
          ],
          t(
            "Measure: online completion rate from 62% to 80%",
            "Mesure : taux d’achèvement en ligne de 62 % à 80 %",
          ),
        ],
        [
          t("Next · planned", "Ensuite · prévu"),
          t(
            "Outcome: fewer calls to the contact centre",
            "Résultat : moins d’appels au centre de contact",
          ),
          [
            [
              t(
                "Proactive email and text updates",
                "Mises à jour proactives par courriel et texto",
              ),
              PALETTE.green,
            ],
            [
              t(
                "Reuse data from other programs",
                "Réutiliser les données d’autres programmes",
              ),
              PALETTE.purple,
            ],
            [
              t(
                "Agent view of saved answers",
                "Vue des réponses enregistrées pour les agents",
              ),
              PALETTE.purple,
            ],
          ],
          t(
            "Measure: status calls down 40%",
            "Mesure : appels sur l’état en baisse de 40 %",
          ),
        ],
        [
          t("Later · exploring", "Plus tard · à explorer"),
          t(
            "Outcome: benefits reach people automatically",
            "Résultat : les prestations arrivent automatiquement",
          ),
          [
            [
              t(
                "Automatic enrolment pilot",
                "Projet pilote d’inscription automatique",
              ),
              PALETTE.purple,
            ],
            [
              t(
                "Chat support in both languages",
                "Clavardage dans les deux langues",
              ),
              PALETTE.blue,
            ],
            [
              t(
                "Mobile app for documents",
                "Application mobile pour les documents",
              ),
              PALETTE.green,
            ],
          ],
          t(
            "Measure: time to first payment under 14 days",
            "Mesure : premier paiement en moins de 14 jours",
          ),
        ],
      ];
      columns.forEach(([title, outcome, notes, measure], n) => {
        const x = n * 460;
        k.frame(x, 160, 420, 660, title);
        k.card(x + 20, 220, 380, 80, outcome, {
          color: PALETTE.navy,
          textColor: "#ffffff",
          textAlign: "left",
          fontSize: 18,
        });
        notes.forEach(([text, color], r) =>
          k.note(x + 20, 320 + r * 120, text, { w: 380, h: 100, color }),
        );
        k.card(x + 20, 700, 380, 100, measure, {
          color: PALETTE.grey,
          textAlign: "left",
        });
      });
      k.frame(
        1380,
        160,
        360,
        660,
        t("Themes and confidence", "Thèmes et confiance"),
      );
      [
        [
          t("Access: easier to apply", "Accès : faciliter la demande"),
          PALETTE.green,
        ],
        [
          t("Trust: clear and consistent", "Confiance : clair et cohérent"),
          PALETTE.blue,
        ],
        [
          t(
            "Efficiency: less manual work",
            "Efficacité : moins de travail manuel",
          ),
          PALETTE.purple,
        ],
      ].forEach(([text, color], n) =>
        k.note(1400, 220 + n * 120, text, { w: 320, h: 100, color }),
      );
      k.card(
        1400,
        580,
        320,
        220,
        t(
          "Now: funded and in delivery, high confidence.\nNext: likely within 6 months, medium confidence.\nLater: ideas to validate, low confidence.\nReview the roadmap every quarter.",
          "Maintenant : financé et en cours, confiance élevée.\nEnsuite : probable d’ici 6 mois, confiance moyenne.\nPlus tard : idées à valider, faible confiance.\nRevoyez la feuille de route chaque trimestre.",
        ),
        { textAlign: "left" },
      );
    },
  },
  {
    id: "roadmap-quarterly",
    category: "product",
    name: ["Quarterly roadmap", "Feuille de route trimestrielle"],
    description: [
      "Plan initiatives across four quarters with theme swimlanes and milestones.",
      "Planifier les initiatives sur quatre trimestres, par thème, avec des jalons.",
    ],
    keywords: [
      "roadmap quarter timeline swimlane milestones plan year digital transformation",
      "feuille de route trimestre calendrier couloir jalons plan année transformation numérique",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        2260,
        t("Quarterly roadmap", "Feuille de route trimestrielle"),
        t(
          "Each lane is a theme and each bar is an initiative: stretch a bar across the quarters it spans. Diamonds mark milestones. Colors show confidence.",
          "Chaque couloir représente un thème et chaque barre, une initiative : étirez la barre sur les trimestres visés. Les losanges marquent les jalons. Les couleurs indiquent la confiance.",
        ),
      );
      k.frame(
        0,
        140,
        1860,
        980,
        t("2026 to 2027 roadmap", "Feuille de route 2026-2027"),
      );
      [
        t("Q1 · Apr to Jun", "T1 · avr. à juin"),
        t("Q2 · Jul to Sep", "T2 · juill. à sept."),
        t("Q3 · Oct to Dec", "T3 · oct. à déc."),
        t("Q4 · Jan to Mar", "T4 · janv. à mars"),
      ].forEach((text, q) =>
        k.card(240 + q * 400, 200, 380, 60, text, {
          color: PALETTE.grey,
          fontSize: 18,
          textAlign: "center",
        }),
      );
      for (let q = 1; q < 4; q++)
        k.line(230 + q * 400, 200, 230 + q * 400, 1100, {
          lineStyle: "dashed",
          color: PALETTE.line,
        });
      const lanes = [
        [
          t("Digital services", "Services numériques"),
          [
            [
              0,
              0,
              2,
              t(
                "Online application redesign",
                "Refonte de la demande en ligne",
              ),
              PALETTE.green,
            ],
            [1, 2, 2, t("Status tracking", "Suivi de l’état"), PALETTE.blue],
          ],
        ],
        [
          t("Data and platforms", "Données et plateformes"),
          [
            [
              0,
              0,
              1,
              t("Cloud migration", "Migration vers le nuage"),
              PALETTE.green,
            ],
            [
              1,
              1,
              3,
              t("Shared identity service", "Service d’identité commun"),
              PALETTE.blue,
            ],
          ],
        ],
        [
          t("Policy and privacy", "Politiques et vie privée"),
          [
            [
              0,
              0,
              1,
              t(
                "Privacy impact assessment",
                "Évaluation des facteurs relatifs à la vie privée",
              ),
              PALETTE.green,
            ],
            [
              1,
              2,
              2,
              t(
                "Automatic enrolment rules",
                "Règles d’inscription automatique",
              ),
              PALETTE.purple,
            ],
          ],
        ],
        [
          t("People and skills", "Personnes et compétences"),
          [
            [
              0,
              1,
              2,
              t("Hire a product team", "Recruter une équipe produit"),
              PALETTE.blue,
            ],
            [
              1,
              3,
              1,
              t("Agent training", "Formation des agents"),
              PALETTE.purple,
            ],
          ],
        ],
      ];
      lanes.forEach(([title, bars], n) => {
        const y = 280 + n * 180;
        k.shape("lane-header", 20, y, 200, 160, title, {
          color: PALETTE.blue,
          fontSize: 18,
        });
        for (const [row, start, span, text, color] of bars)
          k.shape(
            "terminator",
            240 + start * 400,
            y + 20 + row * 70,
            span * 400 - 20,
            50,
            text,
            {
              color,
              textAlign: "left",
            },
          );
      });
      k.shape("lane-header", 20, 1000, 200, 100, t("Milestones", "Jalons"), {
        color: PALETTE.orange,
        fontSize: 18,
      });
      // Each label ends before the next quarter's line.
      [
        [400, t("Beta opens to 500 users", "Version bêta pour 500 usagers")],
        [1120, t("Public launch", "Lancement public")],
        [1640, t("Program evaluation", "Évaluation du programme")],
      ].forEach(([x, text]) => {
        k.shape("diamond", x, 1020, 60, 60, "", { color: PALETTE.orange });
        k.text(x + 70, 1035, 150, text, { fontSize: 14 });
      });
      k.frame(1900, 140, 360, 520, t("Legend", "Légende"));
      [
        [
          t("Green: committed and funded", "Vert : engagé et financé"),
          PALETTE.green,
        ],
        [
          t(
            "Blue: planned, dependencies known",
            "Bleu : prévu, dépendances connues",
          ),
          PALETTE.blue,
        ],
        [
          t(
            "Purple: exploring, needs validation",
            "Violet : à explorer, à valider",
          ),
          PALETTE.purple,
        ],
      ].forEach(([text, color], n) =>
        k.card(1920, 200 + n * 100, 320, 80, text, {
          color,
          textAlign: "left",
        }),
      );
      k.card(
        1920,
        500,
        320,
        140,
        t(
          "Update monthly. Move bars instead of adding dates you are not sure of.",
          "Mettez à jour chaque mois. Déplacez les barres plutôt que d’ajouter des dates incertaines.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
    },
  },
  {
    id: "okrs",
    category: "product",
    name: ["OKRs", "OKR"],
    description: [
      "Set objectives with measurable key results, baselines, and targets.",
      "Définir des objectifs et des résultats clés mesurables, avec valeurs de départ et cibles.",
    ],
    keywords: [
      "objectives key results okr goals targets measures",
      "objectifs résultats clés okr buts cibles mesures",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        2200,
        t("Objectives and key results", "Objectifs et résultats clés"),
        t(
          "Write an inspiring, qualitative objective, then 2 to 4 measurable key results. Record the baseline and target, update confidence weekly, and link the initiatives that move each result.",
          "Rédigez un objectif qualitatif et inspirant, puis 2 à 4 résultats clés mesurables. Notez la valeur de départ et la cible, mettez à jour la confiance chaque semaine et reliez les initiatives.",
        ),
      );
      const objectives = [
        [
          t(
            "Objective 1: applying online is simple and fast",
            "Objectif 1 : présenter une demande en ligne est simple et rapide",
          ),
          [
            [
              t("KR1 Online completion rate", "RC1 Taux d’achèvement en ligne"),
              "62%",
              "80%",
              "7/10",
            ],
            [
              t("KR2 Median time to apply", "RC2 Durée médiane de la demande"),
              "45 min",
              "20 min",
              "5/10",
            ],
            [
              t("KR3 Satisfaction score", "RC3 Satisfaction"),
              "3.6/5",
              "4.3/5",
              "6/10",
            ],
          ],
          [
            t(
              "Redesign the application form",
              "Refaire le formulaire de demande",
            ),
            t("Save and resume", "Enregistrer et reprendre"),
          ],
        ],
        [
          t(
            "Objective 2: people always know where their file stands",
            "Objectif 2 : les gens savent toujours où en est leur dossier",
          ),
          [
            [
              t(
                "KR1 Status calls per week",
                "RC1 Appels sur l’état par semaine",
              ),
              "4,200",
              "2,000",
              "6/10",
            ],
            [
              t("KR2 Applicants using tracking", "RC2 Usagers du suivi"),
              "0%",
              "60%",
              "8/10",
            ],
            [
              t("KR3 Complaints about delays", "RC3 Plaintes sur les délais"),
              "310",
              "150",
              "4/10",
            ],
          ],
          [
            t("Status tracking page", "Page de suivi de l’état"),
            t("Proactive notifications", "Avis proactifs"),
          ],
        ],
        [
          t(
            "Objective 3: the team delivers value every sprint",
            "Objectif 3 : l’équipe livre de la valeur à chaque sprint",
          ),
          [
            [
              t("KR1 Releases per month", "RC1 Mises en production par mois"),
              "1",
              "4",
              "7/10",
            ],
            [
              t("KR2 Lead time for changes", "RC2 Délai des changements"),
              "21 days",
              "5 days",
              "5/10",
            ],
            [
              t(
                "KR3 Accessibility issues open",
                "RC3 Problèmes d’accessibilité ouverts",
              ),
              "37",
              "0",
              "6/10",
            ],
          ],
          [
            t(
              "Automated deployment pipeline",
              "Pipeline de déploiement automatisé",
            ),
            t(
              "Accessibility testing in every sprint",
              "Tests d’accessibilité à chaque sprint",
            ),
          ],
        ],
      ];
      objectives.forEach(([objective, results, initiatives], n) => {
        const x = n * 600;
        k.frame(x, 160, 560, 660, t(`Objective ${n + 1}`, `Objectif ${n + 1}`));
        k.card(x + 20, 220, 520, 100, objective, {
          color: PALETTE.navy,
          textColor: "#ffffff",
          fontSize: 20,
          textAlign: "left",
        });
        k.table(
          x + 20,
          340,
          520,
          [
            [
              t("Key result", "Résultat clé"),
              t("Baseline", "Départ"),
              t("Target", "Cible"),
              t("Confidence", "Confiance"),
            ],
            ...results.map(([name, ...values]) => [
              name,
              ...values.map((v) => (k.fr ? frenchValue(v) : v)),
            ]),
          ],
          {
            columnWidths: [220, 100, 100, 100],
            h: 250,
            rowHeights: [40, 70, 70, 70],
          },
        );
        k.text(x + 20, 610, 520, t("Initiatives", "Initiatives"), {
          fontSize: 16,
          bold: true,
        });
        initiatives.forEach((text, r) =>
          k.note(x + 20 + r * 270, 650, text, {
            w: 250,
            h: 120,
            color: PALETTE.green,
          }),
        );
      });
      k.frame(
        1800,
        160,
        400,
        660,
        t("Scoring and check-ins", "Notation et suivis"),
      );
      [
        [
          t(
            "Confidence: 1 to 10, updated at every weekly check-in.",
            "Confiance : de 1 à 10, mise à jour à chaque suivi hebdomadaire.",
          ),
          PALETTE.blue,
        ],
        [
          t(
            "Score at quarter end: 0.0 to 1.0. 0.7 is a good result for an ambitious KR.",
            "Note de fin de trimestre : de 0,0 à 1,0. 0,7 est un bon résultat pour un RC ambitieux.",
          ),
          PALETTE.yellow,
        ],
        [
          t(
            "Good KRs measure outcomes, not tasks. “Launch the page” is an initiative, not a key result.",
            "Un bon RC mesure un résultat, pas une tâche. « Lancer la page » est une initiative, pas un résultat clé.",
          ),
          PALETTE.grey,
        ],
      ].forEach(([text, color], n) =>
        k.card(1820, 220 + n * 200, 360, 180, text, {
          color,
          textAlign: "left",
        }),
      );
    },
  },
  {
    id: "prioritization-matrix",
    category: "product",
    name: ["Impact and effort matrix", "Matrice impact et effort"],
    description: [
      "Sort ideas into quick wins, major projects, fill-ins, and thankless tasks.",
      "Classer les idées : gains rapides, grands projets, tâches d’appoint et tâches ingrates.",
    ],
    keywords: [
      "prioritization matrix 2x2 impact effort quick wins",
      "priorisation matrice 2x2 impact effort gains rapides",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1720,
        t("Impact and effort matrix", "Matrice impact et effort"),
        t(
          "Place each idea by its expected impact for users and the effort to deliver it. Start with quick wins, plan major projects, and question thankless tasks.",
          "Placez chaque idée selon son impact attendu pour les usagers et l’effort requis. Commencez par les gains rapides, planifiez les grands projets et remettez en question les tâches ingrates.",
        ),
      );
      const quadrants = [
        [
          120,
          140,
          t("Quick wins", "Gains rapides"),
          t(
            "High impact, low effort: do these first.",
            "Impact élevé, effort faible : à faire en premier.",
          ),
          PALETTE.green,
          [
            t(
              "Fix the confusing error messages",
              "Corriger les messages d’erreur confus",
            ),
            t(
              "Add office hours to the contact page",
              "Ajouter les heures à la page de contact",
            ),
          ],
        ],
        [
          720,
          140,
          t("Major projects", "Grands projets"),
          t(
            "High impact, high effort: plan and fund them.",
            "Impact élevé, effort élevé : à planifier et financer.",
          ),
          PALETTE.blue,
          [
            t("Online status tracking", "Suivi de l’état en ligne"),
            t(
              "Reuse data from other programs",
              "Réutiliser les données d’autres programmes",
            ),
          ],
        ],
        [
          120,
          600,
          t("Fill-ins", "Tâches d’appoint"),
          t(
            "Low impact, low effort: do them when there is time.",
            "Impact faible, effort faible : à faire au besoin.",
          ),
          PALETTE.yellow,
          [
            t(
              "New icons for the dashboard",
              "Nouvelles icônes pour le tableau de bord",
            ),
          ],
        ],
        [
          720,
          600,
          t("Thankless tasks", "Tâches ingrates"),
          t(
            "Low impact, high effort: avoid or rethink.",
            "Impact faible, effort élevé : à éviter ou repenser.",
          ),
          PALETTE.orange,
          [
            t(
              "Rebuild the internal reporting tool",
              "Refaire l’outil de rapports interne",
            ),
          ],
        ],
      ];
      for (const [x, y, title, prompt, color, notes] of quadrants) {
        k.frame(x, y, 560, 420, title);
        k.card(x + 20, y + 60, 520, 60, prompt, {
          color: PALETTE.grey,
          textAlign: "left",
        });
        notes.forEach((text, n) =>
          k.note(x + 20 + n * 200, y + 140, text, { w: 180, h: 140, color }),
        );
      }
      k.line(80, 1020, 80, 140, {
        endCap: "arrow",
        color: PALETTE.muted,
        lineWidth: 3,
      });
      k.line(120, 1060, 1280, 1060, {
        endCap: "arrow",
        color: PALETTE.muted,
        lineWidth: 3,
      });
      k.text(-80, 565, 250, t("Impact", "Impact"), {
        fontSize: 20,
        bold: true,
        textAlign: "center",
        rotation: -90,
      });
      k.text(0, 150, 70, t("High", "Élevé"), { fontSize: 14 });
      k.text(0, 990, 70, t("Low", "Faible"), { fontSize: 14 });
      k.text(580, 1080, 240, t("Effort", "Effort"), {
        fontSize: 20,
        bold: true,
        textAlign: "center",
      });
      k.text(120, 1080, 120, t("Low", "Faible"), { fontSize: 14 });
      k.text(1160, 1080, 120, t("High", "Élevé"), {
        fontSize: 14,
        textAlign: "right",
      });
      k.frame(1320, 140, 400, 880, t("Ideas to place", "Idées à placer"));
      [
        t("Text message reminders", "Rappels par texto"),
        t("Chat support pilot", "Projet pilote de clavardage"),
        t("Printable application summary", "Résumé imprimable de la demande"),
      ].forEach((text, n) =>
        k.note(1340, 200 + n * 180, text, {
          w: 360,
          h: 160,
          color: PALETTE.purple,
        }),
      );
      k.card(
        1340,
        760,
        360,
        240,
        t(
          "Estimate impact with evidence: research, analytics, call volumes. Estimate effort with the delivery team, not alone.",
          "Estimez l’impact à partir de données probantes : recherche, analytique, volume d’appels. Estimez l’effort avec l’équipe de livraison.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
    },
  },
  {
    id: "rice",
    category: "product",
    name: ["RICE scoring", "Notation RICE"],
    description: [
      "Rank ideas by reach, impact, confidence, and effort.",
      "Classer les idées selon la portée, l’impact, la confiance et l’effort.",
    ],
    keywords: [
      "rice scoring prioritization reach impact confidence effort",
      "rice notation priorisation portée impact confiance effort",
    ],
    build(k) {
      const { t } = k;
      intro(
        k,
        1340,
        t("RICE scoring", "Notation RICE"),
        t(
          "Score each idea with the team, calculate the RICE score, then sort from highest to lowest. Use the score to start the conversation, not to end it.",
          "Notez chaque idée en équipe, calculez le score RICE, puis triez du plus élevé au plus faible. Le score lance la discussion, il ne la conclut pas.",
        ),
      );
      k.frame(0, 140, 1340, 540, t("Score your ideas", "Notez vos idées"));
      const n = (en, fr) => t(en, fr);
      k.table(
        20,
        200,
        1300,
        [
          [
            t("Idea", "Idée"),
            t("Reach (per quarter)", "Portée (par trimestre)"),
            t("Impact", "Impact"),
            t("Confidence", "Confiance"),
            t("Effort (person-months)", "Effort (mois-personnes)"),
            t("RICE score", "Score RICE"),
            t("Rank", "Rang"),
          ],
          [
            t("Plain language letters", "Lettres en langage clair"),
            n("30,000", "30 000"),
            "1",
            n("80%", "80 %"),
            "2",
            n("12,000", "12 000"),
            "1",
          ],
          [
            t(
              "Save and resume applications",
              "Enregistrer et reprendre une demande",
            ),
            n("12,000", "12 000"),
            "2",
            n("80%", "80 %"),
            "3",
            n("6,400", "6 400"),
            "2",
          ],
          [
            t("Online status tracking", "Suivi de l’état en ligne"),
            n("20,000", "20 000"),
            "1",
            n("100%", "100 %"),
            "4",
            n("5,000", "5 000"),
            "3",
          ],
          [
            t("Chat support pilot", "Projet pilote de clavardage"),
            n("3,000", "3 000"),
            "2",
            n("50%", "50 %"),
            "6",
            "500",
            "4",
          ],
          ["", "", "", "", "", "", ""],
          ["", "", "", "", "", "", ""],
        ],
        {
          columnWidths: [360, 180, 120, 140, 200, 160, 140],
          h: 420,
          rowHeights: [60, 60, 60, 60, 60, 60, 60],
        },
      );
      k.card(
        20,
        620,
        1300,
        40,
        t(
          "Tip: sort by RICE score, then check the top items against strategy and dependencies.",
          "Astuce : triez par score RICE, puis vérifiez les premiers éléments selon la stratégie et les dépendances.",
        ),
        { color: PALETTE.grey, fontSize: 14, textAlign: "left" },
      );
      k.frame(0, 720, 640, 320, t("Formula", "Formule"));
      k.card(
        20,
        780,
        600,
        100,
        t(
          "RICE = (Reach × Impact × Confidence) ÷ Effort",
          "RICE = (Portée × Impact × Confiance) ÷ Effort",
        ),
        {
          color: PALETTE.navy,
          textColor: "#ffffff",
          fontSize: 22,
          textAlign: "center",
        },
      );
      k.card(
        20,
        900,
        600,
        120,
        t(
          "Example: 12,000 applicants × 2 × 80% ÷ 3 person-months = 6,400",
          "Exemple : 12 000 demandeurs × 2 × 80 % ÷ 3 mois-personnes = 6 400",
        ),
        { color: PALETTE.yellow, textAlign: "left", fontSize: 16 },
      );
      k.frame(680, 720, 660, 320, t("Scale guide", "Guide des échelles"));
      k.table(
        700,
        780,
        620,
        [
          [t("Factor", "Facteur"), t("How to score", "Comment noter")],
          [
            t("Reach", "Portée"),
            t(
              "People or events affected per quarter",
              "Personnes ou événements touchés par trimestre",
            ),
          ],
          [
            t("Impact", "Impact"),
            t(
              "3 massive · 2 high · 1 medium · 0.5 low · 0.25 minimal",
              "3 énorme · 2 élevé · 1 moyen · 0,5 faible · 0,25 minime",
            ),
          ],
          [
            t("Confidence", "Confiance"),
            t(
              "100% high · 80% medium · 50% low",
              "100 % élevée · 80 % moyenne · 50 % faible",
            ),
          ],
          [
            t("Effort", "Effort"),
            t(
              "Person-months for the whole team",
              "Mois-personnes pour toute l’équipe",
            ),
          ],
        ],
        { columnWidths: [160, 460], h: 240, rowHeights: [40, 50, 50, 50, 50] },
      );
    },
  },
];
