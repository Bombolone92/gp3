import { PALETTE } from "./kit.js";
// Slide decks: 16:9 frames, the size of a PowerPoint slide, in reading order,
// three to a row. Presenting shows each frame as a slide without its title,
// so every slide carries its own heading; exporting gives one slide or PDF
// page per frame.
const W = 1280,
  H = 720,
  GAP = 80,
  M = 80;
function deck(k, slides) {
  slides.forEach(([title, fill], n) => {
    const x = (n % 3) * (W + GAP),
      y = Math.floor(n / 3) * (H + GAP);
    k.frame(x, y, W, H, `${n + 1} · ${title}`);
    fill(x, y);
  });
}
const heading = (k, x, y, text, extra = {}) =>
  k.heading(x + M, y + 90, W - 2 * M, text, { fontSize: 44, ...extra });
// A short accent rule under a heading, as slide layouts have.
const rule = (k, x, y) =>
  k.shape("rectangle", x + M, y, 120, 8, "", { color: PALETTE.emphasis });
// The first line of a card, its number or figure, is bold.
const lead = (text) => ({
  textRuns: [
    { start: 0, end: text.split("\n")[0].length, style: { bold: true } },
  ],
});
const cards = (k, x, y, w, h, list, extra = {}) =>
  list.forEach(([text, color], n) =>
    k.card(x + n * (w + 30), y, w, h, text, {
      color: color || PALETTE.white,
      textAlign: "left",
      textValign: "top",
      ...lead(text),
      ...extra,
    }),
  );
export default [
  {
    id: "presentation-deck",
    category: "workshops",
    name: ["Presentation", "Présentation"],
    description: [
      "Six 16:9 slides to present work: title, agenda, context, key points, results, and next steps.",
      "Six diapositives 16:9 pour présenter un travail : titre, ordre du jour, contexte, points clés, résultats et prochaines étapes.",
    ],
    keywords: [
      "slides deck slideshow pitch report review demo presentation powerpoint",
      "diapositives diaporama exposé rapport bilan démonstration présentation powerpoint",
    ],
    build(k) {
      const { t } = k,
        { blue, green, yellow, purple } = PALETTE;
      deck(k, [
        [
          t("Title", "Titre"),
          (x, y) => {
            k.text(
              x + M + 20,
              y + 170,
              W - 2 * M - 40,
              t(
                "Digital services team · Quarterly review",
                "Équipe des services numériques · Bilan trimestriel",
              ),
              { fontSize: 22 },
            );
            k.heading(
              x + M + 20,
              y + 220,
              W - 2 * M - 40,
              t(
                "Making benefit applications simpler",
                "Simplifier les demandes de prestations",
              ),
              { fontSize: 60 },
            );
            k.text(
              x + M + 20,
              y + 390,
              W - 2 * M - 40,
              t(
                "What we learned from 40 applicants, and what we will change next",
                "Ce que 40 demandeurs nous ont appris, et ce que nous changerons ensuite",
              ),
              { fontSize: 28 },
            );
            rule(k, x + 20, y + 500);
            k.text(
              x + M + 20,
              y + 540,
              W - 2 * M - 40,
              t(
                "Presenter name · Role · Date",
                "Nom de la personne qui présente · Rôle · Date",
              ),
              { fontSize: 20 },
            );
          },
        ],
        [
          t("Agenda", "Ordre du jour"),
          (x, y) => {
            heading(k, x, y, t("Agenda", "Ordre du jour"));
            rule(k, x, y + 160);
            cards(
              k,
              x + M,
              y + 230,
              (W - 2 * M - 90) / 4,
              240,
              [
                [
                  t(
                    "1\nWhere we are\n\n5 min",
                    "1\nOù nous en sommes\n\n5 min",
                  ),
                ],
                [
                  t(
                    "2\nWhat we learned\n\n10 min",
                    "2\nCe que nous avons appris\n\n10 min",
                  ),
                ],
                [
                  t(
                    "3\nResults so far\n\n10 min",
                    "3\nRésultats à ce jour\n\n10 min",
                  ),
                ],
                [
                  t(
                    "4\nNext steps and questions\n\n5 min",
                    "4\nProchaines étapes et questions\n\n5 min",
                  ),
                ],
              ],
              { fontSize: 22, autoFontSize: false },
            );
          },
        ],
        [
          t("Context", "Contexte"),
          (x, y) => {
            heading(k, x, y, t("Where we are", "Où nous en sommes"));
            rule(k, x, y + 160);
            k.text(
              x + M,
              y + 220,
              520,
              t(
                "Half of the people who start an application online stop before they submit it. Most call the contact centre instead, which takes them three times as long.\n\nThis quarter we watched 40 people apply, in person and remotely, to find out where they stop and why.",
                "La moitié des personnes qui commencent une demande en ligne s’arrêtent avant de la soumettre. La plupart appellent plutôt le centre d’appels, ce qui leur prend trois fois plus de temps.\n\nCe trimestre, nous avons observé 40 personnes faire une demande, en personne et à distance, pour savoir où et pourquoi elles s’arrêtent.",
              ),
              { fontSize: 22 },
            );
            k.shape(
              "wf-image",
              x + 680,
              y + 220,
              520,
              400,
              t("Image or chart", "Image ou graphique"),
              {
                color: PALETTE.grey,
              },
            );
          },
        ],
        [
          t("Key points", "Points clés"),
          (x, y) => {
            heading(k, x, y, t("What we learned", "Ce que nous avons appris"));
            rule(k, x, y + 160);
            cards(
              k,
              x + M,
              y + 230,
              (W - 2 * M - 60) / 3,
              380,
              [
                [
                  t(
                    "68%\n\nstop at the income step, because the words do not match their tax slip.",
                    "68 %\n\ns’arrêtent à l’étape du revenu, parce que les termes ne correspondent pas à leur feuillet d’impôt.",
                  ),
                  blue,
                ],
                [
                  t(
                    "3 in 4\n\nwant to save their answers and come back with documents later.",
                    "3 sur 4\n\nveulent enregistrer leurs réponses et revenir plus tard avec leurs documents.",
                  ),
                  green,
                ],
                [
                  t(
                    "12 minutes\n\nis the median time to finish once the income step is clear.",
                    "12 minutes\n\nest le temps médian pour terminer une fois l’étape du revenu clarifiée.",
                  ),
                  yellow,
                ],
              ],
              { fontSize: 24, autoFontSize: false },
            );
          },
        ],
        [
          t("Results", "Résultats"),
          (x, y) => {
            heading(k, x, y, t("Results so far", "Résultats à ce jour"));
            rule(k, x, y + 160);
            k.table(
              x + M,
              y + 230,
              W - 2 * M,
              [
                [
                  t("Measure", "Mesure"),
                  t("Before", "Avant"),
                  t("After", "Après"),
                  t("Change", "Variation"),
                ],
                [
                  t(
                    "Applications finished online",
                    "Demandes terminées en ligne",
                  ),
                  "52%",
                  "71%",
                  "+19",
                ],
                [
                  t(
                    "Calls about the income step",
                    "Appels sur l’étape du revenu",
                  ),
                  "1,240",
                  "610",
                  "−51%",
                ],
                [
                  t("Median time to finish", "Temps médian pour terminer"),
                  "26 min",
                  "14 min",
                  "−12 min",
                ],
                [
                  t("Satisfaction (out of 5)", "Satisfaction (sur 5)"),
                  "3.1",
                  "4.2",
                  "+1.1",
                ],
              ],
              {
                columnWidths: [440, 220, 220, 240],
                rowHeights: [70, 70, 70, 70, 70],
                h: 350,
                fontSize: 22,
              },
            );
          },
        ],
        [
          t("Next steps", "Prochaines étapes"),
          (x, y) => {
            heading(k, x, y, t("Next steps", "Prochaines étapes"));
            rule(k, x, y + 160);
            k.text(
              x + M,
              y + 220,
              640,
              t(
                "• Rewrite the income step in plain language with the tax slip beside it\n• Let people save and return within 30 days\n• Test both changes with 10 more applicants next month\n• Share results at the next review",
                "• Réécrire l’étape du revenu en langage clair, avec le feuillet d’impôt à côté\n• Permettre d’enregistrer et de revenir dans les 30 jours\n• Mettre les deux changements à l’essai avec 10 autres demandeurs le mois prochain\n• Présenter les résultats au prochain bilan",
              ),
              { fontSize: 24 },
            );
            k.card(
              x + 800,
              y + 220,
              400,
              300,
              t(
                "Questions?\n\nPresenter name\nname@example.org",
                "Des questions?\n\nNom de la personne qui présente\nnom@example.org",
              ),
              { color: purple, fontSize: 24, autoFontSize: false },
            );
          },
        ],
      ]);
    },
  },
  {
    id: "team-onboarding",
    category: "workshops",
    name: ["Team onboarding", "Accueil dans l’équipe"],
    description: [
      "Six 16:9 slides to welcome a new teammate: the team, how it works, tools and access, the first 30 days, and who to ask.",
      "Six diapositives 16:9 pour accueillir une nouvelle personne : l’équipe, son fonctionnement, les outils et accès, les 30 premiers jours et à qui s’adresser.",
    ],
    keywords: [
      "onboarding new hire employee welcome orientation first day induction slides deck",
      "intégration accueil nouvel employé nouvelle recrue orientation premier jour diapositives",
    ],
    build(k) {
      const { t } = k,
        { blue, green, yellow, orange, purple, white } = PALETTE;
      deck(k, [
        [
          t("Welcome", "Bienvenue"),
          (x, y) => {
            k.heading(
              x + M + 20,
              y + 190,
              W - 2 * M - 40,
              t("Welcome to the team, Alex", "Bienvenue dans l’équipe, Alex"),
              { fontSize: 60 },
            );
            k.text(
              x + M + 20,
              y + 300,
              W - 2 * M - 40,
              t(
                "We are glad you are here. These slides walk you through your first month; go through them with your onboarding buddy.",
                "Nous sommes heureux de vous accueillir. Ces diapositives présentent votre premier mois; parcourez-les avec votre personne de référence.",
              ),
              { fontSize: 26 },
            );
            rule(k, x + 20, y + 440);
            k.card(
              x + M + 20,
              y + 490,
              560,
              130,
              t(
                "Your onboarding buddy: Sam Tremblay\nAsk them anything, any time.",
                "Votre personne de référence : Sam Tremblay\nPosez-lui toutes vos questions.",
              ),
              {
                color: blue,
                fontSize: 22,
                autoFontSize: false,
                textAlign: "left",
              },
            );
          },
        ],
        [
          t("Who we are", "Qui nous sommes"),
          (x, y) => {
            heading(k, x, y, t("Who we are", "Qui nous sommes"));
            rule(k, x, y + 160);
            k.text(
              x + M,
              y + 200,
              W - 2 * M,
              t(
                "We design and run the online services people use to apply for benefits, with them, in the open.",
                "Nous concevons et exploitons les services en ligne servant aux demandes de prestations, avec les personnes qui les utilisent, en toute transparence.",
              ),
              { fontSize: 24 },
            );
            [
              [
                t(
                  "Priya Shah\nProduct manager",
                  "Priya Shah\nGestionnaire de produit",
                ),
                yellow,
              ],
              [
                t(
                  "Jordan Lee\nService designer",
                  "Jordan Lee\nConceptrice de services",
                ),
                green,
              ],
              [t("Émilie Roy\nDeveloper", "Émilie Roy\nDéveloppeuse"), blue],
              [
                t(
                  "Sam Tremblay\nUser researcher",
                  "Sam Tremblay\nChercheur en expérience utilisateur",
                ),
                purple,
              ],
              [
                t("You\nWhat will you bring?", "Vous\nQu’apporterez-vous?"),
                orange,
              ],
            ].forEach(([text, color], n) =>
              k.note(x + M + n * 230, y + 330, text, {
                w: 200,
                h: 200,
                color,
                fontSize: 20,
                ...lead(text),
              }),
            );
          },
        ],
        [
          t("How we work", "Notre façon de travailler"),
          (x, y) => {
            heading(k, x, y, t("How we work", "Notre façon de travailler"));
            rule(k, x, y + 160);
            k.table(
              x + M,
              y + 220,
              W - 2 * M,
              [
                [
                  t("Ritual", "Rituel"),
                  t("When", "Quand"),
                  t("Why", "Pourquoi"),
                ],
                [
                  t("Stand-up", "Mêlée quotidienne"),
                  t("Every day, 9:30", "Chaque jour, 9 h 30"),
                  t(
                    "Share plans and ask for help",
                    "Partager les plans et demander de l’aide",
                  ),
                ],
                [
                  t("Sprint planning", "Planification de sprint"),
                  t("Every second Monday", "Un lundi sur deux"),
                  t(
                    "Choose the work for two weeks",
                    "Choisir le travail des deux semaines",
                  ),
                ],
                [
                  t("Demo", "Démonstration"),
                  t("Every second Thursday", "Un jeudi sur deux"),
                  t(
                    "Show working software to the people who use it",
                    "Montrer le logiciel aux personnes qui l’utilisent",
                  ),
                ],
                [
                  t("Retrospective", "Rétrospective"),
                  t("Every second Friday", "Un vendredi sur deux"),
                  t(
                    "Improve how we work together",
                    "Améliorer notre façon de travailler ensemble",
                  ),
                ],
              ],
              {
                columnWidths: [300, 300, 520],
                rowHeights: [64, 76, 76, 76, 76],
                h: 368,
                fontSize: 20,
              },
            );
          },
        ],
        [
          t("Tools and access", "Outils et accès"),
          (x, y) => {
            heading(k, x, y, t("Tools and access", "Outils et accès"));
            rule(k, x, y + 160);
            cards(
              k,
              x + M,
              y + 230,
              (W - 2 * M - 90) / 4,
              290,
              [
                [
                  t(
                    "Day 1\n\nLaptop, account, and building pass from the service desk",
                    "Jour 1\n\nOrdinateur, compte et carte d’accès auprès du centre de services",
                  ),
                  white,
                ],
                [
                  t(
                    "Day 1\n\nChat and email: join the team channel and say hello",
                    "Jour 1\n\nClavardage et courriel : joignez le canal de l’équipe et saluez tout le monde",
                  ),
                  white,
                ],
                [
                  t(
                    "Week 1\n\nCode, design files, and this whiteboard: your buddy adds you",
                    "Semaine 1\n\nCode, fichiers de conception et ce tableau : votre personne de référence vous ajoute",
                  ),
                  white,
                ],
                [
                  t(
                    "Week 2\n\nSecurity and accessibility training, about 2 hours each",
                    "Semaine 2\n\nFormations sur la sécurité et l’accessibilité, environ 2 heures chacune",
                  ),
                  white,
                ],
              ],
              { fontSize: 20, autoFontSize: false },
            );
          },
        ],
        [
          t("Your first 30 days", "Vos 30 premiers jours"),
          (x, y) => {
            heading(k, x, y, t("Your first 30 days", "Vos 30 premiers jours"));
            rule(k, x, y + 160);
            cards(
              k,
              x + M,
              y + 230,
              (W - 2 * M - 90) / 4,
              290,
              [
                [
                  t(
                    "Week 1: meet\n\nOne-on-ones with each teammate and a tour of the service",
                    "Semaine 1 : rencontrer\n\nRencontres individuelles avec chaque collègue et visite du service",
                  ),
                  yellow,
                ],
                [
                  t(
                    "Week 2: learn\n\nSit in on research sessions and read the last three retros",
                    "Semaine 2 : apprendre\n\nAssister à des séances de recherche et lire les trois dernières rétros",
                  ),
                  green,
                ],
                [
                  t(
                    "Week 3: do\n\nPick up a first small task with your buddy",
                    "Semaine 3 : faire\n\nPrendre une première petite tâche avec votre personne de référence",
                  ),
                  blue,
                ],
                [
                  t(
                    "Week 4: share\n\nShow what you did at the demo and tell us what to improve",
                    "Semaine 4 : partager\n\nMontrer votre travail à la démonstration et nous dire quoi améliorer",
                  ),
                  purple,
                ],
              ],
              { fontSize: 20, autoFontSize: false },
            );
          },
        ],
        [
          t("Who to ask", "À qui s’adresser"),
          (x, y) => {
            heading(k, x, y, t("Who to ask", "À qui s’adresser"));
            rule(k, x, y + 160);
            k.table(
              x + M,
              y + 220,
              680,
              [
                [t("Topic", "Sujet"), t("Person", "Personne")],
                [t("Anything at all", "N’importe quoi"), "Sam Tremblay"],
                [
                  t("Priorities and roadmap", "Priorités et feuille de route"),
                  "Priya Shah",
                ],
                [
                  t("Code and deployments", "Code et déploiements"),
                  "Émilie Roy",
                ],
                [
                  t("Leave and pay", "Congés et paie"),
                  t("Your manager", "Votre gestionnaire"),
                ],
              ],
              {
                columnWidths: [380, 300],
                rowHeights: [64, 70, 70, 70, 70],
                h: 344,
                fontSize: 20,
              },
            );
            k.note(
              x + 840,
              y + 220,
              t(
                "Questions after your first week? Add a sticky note here.",
                "Des questions après votre première semaine? Ajoutez une note ici.",
              ),
              { w: 360, h: 220, color: yellow, fontSize: 22 },
            );
          },
        ],
      ]);
    },
  },
];
