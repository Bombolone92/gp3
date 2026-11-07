import { PALETTE } from "./kit.js";
// Shared layout helpers for UX templates.
const prompt = (k, x, y, w, text, h = 60) =>
  k.card(x, y, w, h, text, { color: PALETTE.grey });
const label = (k, x, y, w, text, extra = {}) =>
  k.text(x, y, w, text, { fontSize: 16, bold: true, ...extra });
export default [
  {
    id: "ux",
    category: "ux",
    name: ["UX research canvas", "Canevas de recherche UX"],
    description: [
      "Turn research questions and evidence into insights and design opportunities.",
      "Transformer les questions de recherche et les données en constats et en pistes de conception.",
    ],
    keywords: [
      "user research interviews insights evidence opportunities",
      "recherche utilisateur entrevues constats données pistes",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 2060, t("UX research canvas", "Canevas de recherche UX"));
      k.text(
        0,
        60,
        2060,
        t(
          "How to use: work from left to right. Agree on what you need to learn, record who you spoke with, capture raw evidence, then cluster it into insights and turn each insight into a “How might we” opportunity.",
          "Mode d’emploi : travaillez de gauche à droite. Convenez de ce que vous devez apprendre, notez qui vous avez rencontré, consignez les données brutes, puis regroupez-les en constats et transformez chaque constat en piste « Comment pourrions-nous ».",
        ),
      );
      const columns = [
        [
          t("1. Research questions", "1. Questions de recherche"),
          t(
            "What do we need to learn to make a good decision?",
            "Que devons-nous apprendre pour bien décider?",
          ),
          PALETTE.blue,
          [
            t(
              "Why do applicants abandon the online form?",
              "Pourquoi les demandeurs abandonnent-ils le formulaire en ligne?",
            ),
            t(
              "Which documents are hardest to find?",
              "Quels documents sont les plus difficiles à trouver?",
            ),
            t(
              "How do people with low vision complete the form?",
              "Comment les personnes ayant une basse vision remplissent-elles le formulaire?",
            ),
          ],
        ],
        null,
        [
          t("3. Evidence", "3. Données"),
          t(
            "Quotes, observations and numbers. One per note.",
            "Citations, observations et chiffres. Un par note.",
          ),
          PALETTE.yellow,
          [
            t(
              "“I didn’t know if my session would time out.” (P2)",
              "« Je ne savais pas si ma session allait expirer. » (P2)",
            ),
            t(
              "3 of 6 participants searched for the SIN field",
              "3 participants sur 6 ont cherché le champ du NAS",
            ),
            t(
              "P4 zoomed to 300% and lost the Next button",
              "P4 a zoomé à 300 % et a perdu le bouton Suivant",
            ),
          ],
        ],
        [
          t("4. Insights", "4. Constats"),
          t(
            "What patterns explain the evidence?",
            "Quelles tendances expliquent les données?",
          ),
          PALETTE.purple,
          [
            t(
              "People fear losing their work more than they fear the questions",
              "Les gens craignent davantage de perdre leur travail que les questions elles-mêmes",
            ),
            t(
              "Our labels use program language, not everyday words",
              "Nos libellés emploient le langage des programmes, pas des mots courants",
            ),
          ],
        ],
        [
          t("5. Design opportunities", "5. Pistes de conception"),
          t(
            "Reframe each insight as “How might we…?”",
            "Reformulez chaque constat : « Comment pourrions-nous…? »",
          ),
          PALETTE.green,
          [
            t(
              "How might we save progress automatically?",
              "Comment pourrions-nous enregistrer la progression automatiquement?",
            ),
            t(
              "How might we explain terms in plain language?",
              "Comment pourrions-nous expliquer les termes en langage clair?",
            ),
          ],
        ],
      ];
      columns.forEach((column, n) => {
        const x = n * 420;
        if (!column) {
          k.frame(x, 140, 380, 560, t("2. Participants", "2. Participants"));
          prompt(
            k,
            x + 20,
            200,
            340,
            t(
              "Who did you learn from? Recruit for diversity.",
              "Auprès de qui avez-vous appris? Visez la diversité.",
            ),
          );
          k.table(
            x + 20,
            280,
            340,
            [
              [t("ID", "ID"), t("Profile", "Profil"), t("Method", "Méthode")],
              [
                "P1",
                t("First-time applicant", "Première demande"),
                t("Interview", "Entrevue"),
              ],
              [
                "P2",
                t("Uses a screen reader", "Utilise un lecteur d’écran"),
                t("Usability test", "Test d’utilisabilité"),
              ],
              [
                "P3",
                t("Rural, low bandwidth", "Milieu rural, faible débit"),
                t("Interview", "Entrevue"),
              ],
              [
                "P4",
                t("Low vision, zooms", "Basse vision, zoom"),
                t("Usability test", "Test d’utilisabilité"),
              ],
              ["", "", ""],
              ["", "", ""],
            ],
            {
              columnWidths: [60, 160, 120],
              rowHeights: [40, 60, 60, 60, 60, 60, 60],
              h: 400,
            },
          );
          return;
        }
        const [title, question, color, examples] = column;
        k.frame(x, 140, 380, 560, title);
        prompt(k, x + 20, 200, 340, question);
        examples.forEach((text, e) =>
          k.note(x + 20 + (e % 2) * 180, 280 + Math.floor(e / 2) * 160, text, {
            w: 160,
            h: 140,
            color,
          }),
        );
        const e = examples.length;
        k.note(
          x + 20 + (e % 2) * 180,
          280 + Math.floor(e / 2) * 160,
          t("Add yours", "Ajoutez les vôtres"),
          { w: 160, h: 140, color },
        );
      });
    },
  },
  {
    id: "personas",
    category: "ux",
    name: ["Personas", "Personas"],
    description: [
      "Describe the people you design for: goals, frustrations, needs and context.",
      "Décrire les personnes pour qui vous concevez : objectifs, frustrations, besoins et contexte.",
    ],
    keywords: [
      "persona user profile archetype audience design thinking empathize define",
      "persona profil utilisateur archétype public pensée design empathie définir",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1880, t("Personas", "Personas"));
      k.text(
        0,
        60,
        1880,
        t(
          "How to use: base each persona on research, not assumptions. Fill one sheet per distinct group of people, keep quotes real, and include access needs so accessibility is designed in from the start.",
          "Mode d’emploi : appuyez chaque persona sur la recherche, pas sur des suppositions. Remplissez une fiche par groupe distinct, gardez des citations réelles et incluez les besoins d’accessibilité dès le départ.",
        ),
      );
      const sheet = (x, title, data, example) => {
        k.frame(x, 160, 920, 800, title);
        k.shape("wf-avatar", x + 20, 220, 120, 120, "", {
          color: example ? PALETTE.blue : PALETTE.white,
        });
        k.text(x + 160, 230, 340, data.name, { fontSize: 24, bold: true });
        k.text(x + 160, 280, 340, data.role, { fontSize: 16 });
        k.note(x + 520, 220, data.quote, {
          w: 380,
          h: 120,
          color: PALETTE.purple,
          italic: true,
        });
        data.sections.forEach(([heading, body, color], n) => {
          const sx = x + 20 + (n % 3) * 300,
            sy = 380 + Math.floor(n / 3) * 290;
          label(k, sx, sy, 280, heading);
          k.note(sx, sy + 40, body, { w: 280, h: 220, color });
        });
      };
      sheet(
        0,
        t("Persona 1: example", "Persona 1 : exemple"),
        {
          name: "Amira Haddad",
          role: t(
            "38 · Owns a small bakery in a coastal town",
            "38 ans · Propriétaire d’une petite boulangerie dans une ville côtière",
          ),
          quote: t(
            "“I do my paperwork at night, on my phone, after the kids are asleep.”",
            "« Je fais mes démarches administratives le soir, sur mon téléphone, quand les enfants dorment. »",
          ),
          sections: [
            [
              t("Goals", "Objectifs"),
              t(
                "Apply for a small business grant in one sitting and know when she will hear back.",
                "Demander une subvention pour petite entreprise en une seule séance et savoir quand elle aura une réponse.",
              ),
              PALETTE.green,
            ],
            [
              t("Frustrations", "Frustrations"),
              t(
                "Forms that time out, jargon, and being asked for the same information twice.",
                "Les formulaires qui expirent, le jargon et devoir fournir deux fois les mêmes renseignements.",
              ),
              PALETTE.orange,
            ],
            [
              t("Needs", "Besoins"),
              t(
                "A checklist of documents before she starts and a way to save and return.",
                "Une liste des documents avant de commencer et un moyen d’enregistrer pour revenir plus tard.",
              ),
              PALETTE.blue,
            ],
            [
              t("Behaviours", "Comportements"),
              t(
                "Mobile first. Searches the web before calling. Asks her accountant when unsure.",
                "Mobile d’abord. Cherche en ligne avant d’appeler. Consulte sa comptable en cas de doute.",
              ),
              PALETTE.yellow,
            ],
            [
              t("Context", "Contexte"),
              t(
                "Limited time, patchy rural internet on weekends, French is her first language.",
                "Peu de temps, Internet rural instable la fin de semaine, le français est sa langue première.",
              ),
              PALETTE.yellow,
            ],
            [
              t("Accessibility needs", "Besoins d’accessibilité"),
              t(
                "Mild dyslexia: prefers short sentences, clear headings and plain language.",
                "Légère dyslexie : préfère les phrases courtes, des titres clairs et un langage simple.",
              ),
              PALETTE.purple,
            ],
          ],
        },
        true,
      );
      sheet(960, t("Persona 2", "Persona 2"), {
        name: t("Name", "Nom"),
        role: t("Age · Role · Location", "Âge · Rôle · Lieu"),
        quote: t(
          "A real quote that captures their outlook",
          "Une vraie citation qui résume sa vision",
        ),
        sections: [
          [
            t("Goals", "Objectifs"),
            t(
              "What are they trying to achieve?",
              "Que cherche-t-elle à accomplir?",
            ),
            PALETTE.green,
          ],
          [
            t("Frustrations", "Frustrations"),
            t(
              "What gets in their way today?",
              "Qu’est-ce qui lui nuit aujourd’hui?",
            ),
            PALETTE.orange,
          ],
          [
            t("Needs", "Besoins"),
            t("What must the service provide?", "Que doit offrir le service?"),
            PALETTE.blue,
          ],
          [
            t("Behaviours", "Comportements"),
            t(
              "Habits, channels and tools they use",
              "Habitudes, canaux et outils utilisés",
            ),
            PALETTE.yellow,
          ],
          [
            t("Context", "Contexte"),
            t(
              "Where, when and with whom do they use the service?",
              "Où, quand et avec qui utilise-t-elle le service?",
            ),
            PALETTE.yellow,
          ],
          [
            t("Accessibility needs", "Besoins d’accessibilité"),
            t(
              "Assistive technology, language, literacy or cognitive needs",
              "Technologies d’assistance, langue, littératie ou besoins cognitifs",
            ),
            PALETTE.purple,
          ],
        ],
      });
    },
  },
  {
    id: "empathy-map",
    category: "ux",
    name: ["Empathy map", "Carte d’empathie"],
    description: [
      "Capture what a person says, thinks, does and feels, with their pains and gains.",
      "Consigner ce qu’une personne dit, pense, fait et ressent, avec ses irritants et ses gains.",
    ],
    keywords: [
      "empathy says thinks does feels pains gains design thinking empathize",
      "empathie dit pense fait ressent irritants gains pensée design empathie",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1320, t("Empathy map", "Carte d’empathie"));
      k.text(
        0,
        60,
        1320,
        t(
          "How to use: pick one person from your research. Fill each quadrant with what you heard and saw, then summarize their pains and gains below.",
          "Mode d’emploi : choisissez une personne tirée de votre recherche. Remplissez chaque quadrant avec ce que vous avez entendu et observé, puis résumez ses irritants et ses gains en bas.",
        ),
      );
      const quadrants = [
        [
          0,
          160,
          t("Says", "Dit"),
          t(
            "What do they say out loud? Use direct quotes.",
            "Que dit-elle à voix haute? Utilisez des citations.",
          ),
          PALETTE.yellow,
          [
            t(
              "“Is there a number I can call?”",
              "« Y a-t-il un numéro que je peux appeler? »",
            ),
            t("“I’ll finish this later.”", "« Je terminerai plus tard. »"),
            t(
              "“What does eligible mean here?”",
              "« Que veut dire admissible ici? »",
            ),
          ],
        ],
        [
          800,
          160,
          t("Thinks", "Pense"),
          t(
            "What occupies their thoughts but may not be said?",
            "À quoi pense-t-elle sans forcément le dire?",
          ),
          PALETTE.purple,
          [
            t(
              "Am I going to get this wrong?",
              "Est-ce que je vais me tromper?",
            ),
            t("This will take all evening", "Ça va me prendre toute la soirée"),
            t(
              "Do they already have my information?",
              "N’ont-ils pas déjà mes renseignements?",
            ),
          ],
        ],
        [
          0,
          620,
          t("Does", "Fait"),
          t(
            "What actions and behaviours did you observe?",
            "Quels gestes et comportements avez-vous observés?",
          ),
          PALETTE.blue,
          [
            t(
              "Opens the guide in a second tab",
              "Ouvre le guide dans un deuxième onglet",
            ),
            t(
              "Takes a photo of documents with a phone",
              "Photographie ses documents avec son téléphone",
            ),
            t("Leaves at the payment step", "Abandonne à l’étape du paiement"),
          ],
        ],
        [
          800,
          620,
          t("Feels", "Ressent"),
          t(
            "What emotions came up? What worries or excites them?",
            "Quelles émotions sont apparues? Qu’est-ce qui l’inquiète ou l’enthousiasme?",
          ),
          PALETTE.orange,
          [
            t("Anxious about deadlines", "Anxieuse à propos des échéances"),
            t(
              "Relieved when the progress bar appears",
              "Soulagée quand la barre de progression apparaît",
            ),
            t(
              "Frustrated by repeated questions",
              "Frustrée par les questions répétées",
            ),
          ],
        ],
      ];
      for (const [x, y, title, question, color, notes] of quadrants) {
        k.frame(x, y, 520, 420, title);
        prompt(k, x + 20, y + 60, 480, question, 50);
        notes.forEach((text, n) =>
          k.note(
            x + 20 + (n % 2) * 260,
            y + 130 + Math.floor(n / 2) * 140,
            text,
            {
              w: 220,
              h: 120,
              color,
            },
          ),
        );
        k.note(x + 280, y + 270, t("Add yours", "Ajoutez les vôtres"), {
          w: 220,
          h: 120,
          color,
        });
      }
      k.shape("actor", 580, 460, 160, 200, t("Amira", "Amira"), {
        color: PALETTE.green,
      });
      k.card(
        560,
        680,
        200,
        100,
        t(
          "Who: first-time grant applicant",
          "Qui : demande de subvention pour la première fois",
        ),
        { color: PALETTE.white, textAlign: "center" },
      );
      const summary = [
        [
          0,
          t("Pains", "Irritants"),
          t(
            "Fears, frustrations and obstacles",
            "Craintes, frustrations et obstacles",
          ),
          PALETTE.red,
          [
            t(
              "Losing work when the session expires",
              "Perdre son travail quand la session expire",
            ),
            t("Unclear eligibility rules", "Règles d’admissibilité floues"),
          ],
        ],
        [
          680,
          t("Gains", "Gains"),
          t(
            "What success looks like for them",
            "Ce que la réussite représente pour elle",
          ),
          PALETTE.green,
          [
            t("Finishing in one sitting", "Terminer en une seule séance"),
            t(
              "Knowing exactly when to expect an answer",
              "Savoir exactement quand attendre une réponse",
            ),
          ],
        ],
      ];
      for (const [x, title, question, color, notes] of summary) {
        k.frame(x, 1080, 640, 300, title);
        prompt(k, x + 20, 1140, 600, question, 50);
        notes.forEach((text, n) =>
          k.note(x + 20 + n * 200, 1210, text, { w: 180, h: 140, color }),
        );
        k.note(x + 420, 1210, t("Add yours", "Ajoutez les vôtres"), {
          w: 180,
          h: 140,
          color,
        });
      }
    },
  },
  {
    id: "user-flow",
    category: "ux",
    name: ["User flow", "Parcours utilisateur"],
    description: [
      "Map each step and decision a user takes to finish a task, with standard flowchart symbols.",
      "Représenter chaque étape et décision d’un utilisateur pour accomplir une tâche, avec les symboles d’organigramme.",
    ],
    keywords: [
      "flowchart user flow task flow decision diagram",
      "organigramme parcours flux de tâche décision diagramme",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        1840,
        t(
          "User flow: renew a membership online",
          "Parcours utilisateur : renouveler une adhésion en ligne",
        ),
      );
      k.text(
        0,
        60,
        1840,
        t(
          "How to use: start with the trigger, add one box per step, ask a question at every decision and label each exit. Follow the flow end to end to find dead ends.",
          "Mode d’emploi : partez de l’élément déclencheur, ajoutez une case par étape, posez une question à chaque décision et nommez chaque sortie. Suivez le parcours de bout en bout pour repérer les impasses.",
        ),
      );
      k.frame(0, 140, 1380, 880, t("Flow", "Parcours"));
      const start = k.shape(
        "terminator",
        40,
        410,
        160,
        80,
        t("Start: membership expires soon", "Début : adhésion bientôt expirée"),
        { color: PALETTE.green },
      );
      const visit = k.shape(
        "rectangle",
        260,
        400,
        200,
        100,
        t("Visit the renewal page", "Consulter la page de renouvellement"),
        { color: PALETTE.blue, textAlign: "center" },
      );
      const eligible = k.shape(
        "diamond",
        520,
        380,
        200,
        140,
        t("Eligible to renew online?", "Admissible en ligne?"),
        { color: PALETTE.yellow },
      );
      const other = k.shape(
        "off-page",
        570,
        200,
        100,
        100,
        t("In-person flow", "Parcours en personne"),
        { color: PALETTE.orange },
      );
      const signIn = k.shape(
        "rectangle",
        860,
        400,
        200,
        100,
        t("Sign in to your account", "Se connecter à son compte"),
        { color: PALETTE.blue, textAlign: "center" },
      );
      const details = k.shape(
        "parallelogram",
        1120,
        400,
        220,
        100,
        t("Enter personal details", "Saisir ses renseignements"),
        { color: PALETTE.purple },
      );
      const upload = k.shape(
        "parallelogram",
        1120,
        680,
        220,
        100,
        t("Upload a photo", "Téléverser une photo"),
        { color: PALETTE.purple },
      );
      const photo = k.shape(
        "diamond",
        860,
        660,
        200,
        140,
        t("Photo accepted?", "Photo acceptée?"),
        { color: PALETTE.yellow },
      );
      const retake = k.shape(
        "rectangle",
        860,
        880,
        200,
        100,
        t("Retake the photo", "Reprendre la photo"),
        { color: PALETTE.blue, textAlign: "center" },
      );
      const review = k.shape(
        "rectangle",
        520,
        680,
        200,
        100,
        t("Review, pay and submit", "Vérifier, payer et soumettre"),
        { color: PALETTE.blue, textAlign: "center" },
      );
      const confirm = k.shape(
        "document",
        260,
        680,
        200,
        100,
        t("Confirmation email", "Courriel de confirmation"),
        { color: PALETTE.white },
      );
      const end = k.shape(
        "terminator",
        40,
        690,
        160,
        80,
        t("End: application sent", "Fin : demande envoyée"),
        { color: PALETTE.green },
      );
      const flow = { lineType: "elbow" };
      k.connect(start, visit, flow);
      k.connect(visit, eligible, flow);
      k.connect(eligible, signIn, { ...flow, text: t("Yes", "Oui") });
      k.connect(eligible, other, { ...flow, text: t("No", "Non") });
      k.connect(signIn, details, flow);
      k.connect(details, upload, flow);
      k.connect(upload, photo, flow);
      k.connect(photo, review, { ...flow, text: t("Yes", "Oui") });
      k.connect(photo, retake, { ...flow, text: t("No", "Non") });
      k.connect(retake, upload);
      k.connect(review, confirm, flow);
      k.connect(confirm, end, flow);
      k.frame(1420, 140, 420, 880, t("Legend", "Légende"));
      const legend = [
        ["terminator", t("Start or end", "Début ou fin"), PALETTE.green],
        ["rectangle", t("Step or screen", "Étape ou écran"), PALETTE.blue],
        ["diamond", t("Decision", "Décision"), PALETTE.yellow],
        [
          "parallelogram",
          t("User enters data", "Saisie de données"),
          PALETTE.purple,
        ],
        [
          "document",
          t("Document or message", "Document ou message"),
          PALETTE.white,
        ],
        [
          "off-page",
          t("Continues in another flow", "Suite dans un autre parcours"),
          PALETTE.orange,
        ],
      ];
      legend.forEach(([key, text, color], n) => {
        k.shape(key, 1440, 200 + n * 100, 120, 70, "", { color });
        k.text(1580, 220 + n * 100, 240, text, { fontSize: 16 });
      });
      k.note(
        1440,
        820,
        t(
          "Tip: every decision needs a labelled exit for each answer.",
          "Astuce : chaque décision doit avoir une sortie nommée pour chaque réponse.",
        ),
        { w: 380, h: 160, color: PALETTE.yellow },
      );
    },
  },
  {
    id: "wireframe",
    category: "ux",
    name: ["Mobile app wireframe", "Maquette d’application mobile"],
    description: [
      "Sketch a three-screen mobile flow with wireframe components and annotations.",
      "Esquisser un parcours mobile de trois écrans avec des composants et des annotations.",
    ],
    keywords: [
      "wireframe mockup mobile app screen prototype ui design thinking prototype",
      "maquette fonctionnelle mobile application écran prototype interface pensée design prototype",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        1400,
        t("Mobile app wireframe", "Maquette d’application mobile"),
      );
      k.text(
        0,
        60,
        1400,
        t(
          "How to use: keep screens low fidelity. Swap components from the shape library, number the details that need explaining, and connect screens to show where each tap leads.",
          "Mode d’emploi : gardez des écrans peu détaillés. Remplacez les composants à partir de la bibliothèque de formes, numérotez les détails à expliquer et reliez les écrans pour montrer où mène chaque toucher.",
        ),
      );
      const phones = [];
      const links = [];
      let arrival;
      const screen = (n, title, build, notes) => {
        const x = n * 480;
        k.frame(x, 160, 440, 1100, title);
        const phone = k.shape("wf-phone", x + 40, 220, 360, 720, "", {
          color: PALETTE.white,
        });
        phones.push(phone);
        build(x + 60);
        notes.forEach((text, i) =>
          k.note(x + 20 + i * 210, 980, text, {
            w: 190,
            h: 120,
            color: PALETTE.yellow,
          }),
        );
        k.note(x + 20, 1120, t("Add a note", "Ajoutez une note"), {
          w: 190,
          h: 120,
          color: PALETTE.yellow,
        });
      };
      const left = { textAlign: "left" };
      screen(
        0,
        t("1. Home", "1. Accueil"),
        (sx) => {
          k.shape(
            "wf-navbar",
            sx,
            280,
            320,
            60,
            t("Benefits finder", "Recherche de prestations"),
          );
          k.text(
            sx,
            350,
            320,
            t("Find benefits for you", "Trouvez vos prestations"),
            { fontSize: 20, bold: true },
          );
          k.shape(
            "wf-search",
            sx,
            400,
            320,
            50,
            t("Search benefits", "Rechercher une prestation"),
            left,
          );
          links.push(
            k.shape(
              "wf-card",
              sx,
              470,
              320,
              180,
              t("Child care benefit", "Prestation pour garde d’enfants"),
            ),
          );
          k.shape(
            "wf-card",
            sx,
            670,
            320,
            110,
            t("Dental coverage", "Couverture dentaire"),
          );
          k.shape("wf-tabbar", sx, 800, 320, 60);
          // One label under each of the bar's four tabs.
          [
            t("Home", "Accueil"),
            t("Search", "Recherche"),
            t("Saved", "Favoris"),
            t("Profile", "Profil"),
          ].forEach((text, n) =>
            k.text(sx + n * 80, 832, 80, text, {
              fontSize: 12,
              textAlign: "center",
            }),
          );
        },
        [
          t(
            "1. Search suggests benefits as you type",
            "1. La recherche suggère des prestations pendant la saisie",
          ),
          t(
            "2. Cards show the most requested benefits",
            "2. Les cartes affichent les prestations les plus demandées",
          ),
        ],
      );
      screen(
        1,
        t("2. Benefit details", "2. Détails de la prestation"),
        (sx) => {
          k.shape(
            "wf-navbar",
            sx,
            280,
            320,
            60,
            t("Child care benefit", "Prestation pour garde d’enfants"),
          );
          k.shape(
            "wf-image",
            sx,
            350,
            320,
            150,
            t("Illustration", "Illustration"),
          );
          k.shape("wf-paragraph", sx, 520, 320, 100, "");
          k.shape(
            "wf-toggle",
            sx,
            640,
            320,
            40,
            t("Notify me of changes", "M’aviser des changements"),
            left,
          );
          links.push(
            k.shape(
              "wf-button",
              sx,
              700,
              320,
              50,
              t("Check eligibility", "Vérifier l’admissibilité"),
              { color: PALETTE.blue },
            ),
          );
          k.shape("wf-button", sx, 770, 320, 50, t("Share", "Partager"));
        },
        [
          t(
            "3. Plain language summary above the fold",
            "3. Résumé en langage clair visible sans défiler",
          ),
          t(
            "4. One primary action per screen",
            "4. Une seule action principale par écran",
          ),
        ],
      );
      screen(
        2,
        t("3. Eligibility check", "3. Vérification de l’admissibilité"),
        (sx) => {
          k.shape(
            "wf-navbar",
            sx,
            280,
            320,
            60,
            t("Check eligibility", "Vérifier l’admissibilité"),
          );
          k.shape(
            "wf-progress",
            sx,
            350,
            320,
            30,
            t("Step 1 of 3", "Étape 1 de 3"),
          );
          k.shape(
            "wf-input",
            sx,
            400,
            320,
            50,
            t("Date of birth", "Date de naissance"),
            left,
          );
          k.shape("wf-dropdown", sx, 470, 320, 50, t("Region", "Région"), left);
          k.shape(
            "wf-radio",
            sx,
            540,
            320,
            40,
            t(
              "I have children under 18",
              "J’ai des enfants de moins de 18 ans",
            ),
            left,
          );
          k.shape(
            "wf-radio",
            sx,
            590,
            320,
            40,
            t("I do not have children", "Je n’ai pas d’enfants"),
            left,
          );
          k.shape(
            "wf-checkbox",
            sx,
            650,
            320,
            40,
            t(
              "I agree to the privacy notice",
              "J’accepte l’avis de confidentialité",
            ),
            left,
          );
          arrival = k.shape(
            "wf-button",
            sx,
            720,
            320,
            50,
            t("Continue", "Continuer"),
            { color: PALETTE.blue },
          );
        },
        [
          t(
            "5. Show progress so people know how long it takes",
            "5. Afficher la progression pour indiquer la durée",
          ),
          t(
            "6. Validate each field inline, in plain language",
            "6. Valider chaque champ sur place, en langage clair",
          ),
        ],
      );
      k.connect(links[0], phones[1], { text: t("Tap", "Toucher") });
      // Level with the button it leaves, so the line and its label stay in
      // the gap between the screens.
      k.connect(links[1], arrival, { text: t("Tap", "Toucher") });
    },
  },
  {
    id: "wireframe-desktop",
    category: "ux",
    name: ["Web page wireframe", "Maquette de page Web"],
    description: [
      "Lay out a desktop web page with navigation, hero, cards, a form and annotations.",
      "Disposer une page Web avec navigation, bannière, cartes, formulaire et annotations.",
    ],
    keywords: [
      "wireframe desktop website page layout mockup",
      "maquette site Web page ordinateur mise en page",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1740, t("Web page wireframe", "Maquette de page Web"));
      k.text(
        0,
        60,
        1740,
        t(
          "How to use: block out the page with wireframe components before writing final content. Numbered markers link each area to the annotation that explains its behaviour.",
          "Mode d’emploi : structurez la page avec des composants avant de rédiger le contenu final. Les repères numérotés relient chaque zone à l’annotation qui explique son comportement.",
        ),
      );
      k.frame(
        0,
        140,
        1280,
        1520,
        t("Page: family benefits", "Page : prestations familiales"),
      );
      k.shape("browser", 40, 200, 1200, 1420, "", { color: PALETTE.white });
      const left = { textAlign: "left" };
      k.shape(
        "wf-navbar",
        60,
        260,
        1160,
        60,
        t(
          "Service name     Home     Benefits     Accounts     Contact us",
          "Nom du service     Accueil     Prestations     Comptes     Contactez-nous",
        ),
        left,
      );
      k.text(
        60,
        348,
        700,
        t(
          "Home  >  Benefits  >  Family benefits",
          "Accueil  >  Prestations  >  Prestations familiales",
        ),
        { fontSize: 14 },
      );
      k.shape(
        "wf-search",
        900,
        340,
        320,
        50,
        t("Search the site", "Rechercher dans le site"),
        left,
      );
      k.shape(
        "wf-image",
        60,
        410,
        560,
        300,
        t("Hero image", "Image principale"),
      );
      k.text(660, 410, 560, t("Family benefits", "Prestations familiales"), {
        fontSize: 32,
        bold: true,
      });
      k.shape("wf-paragraph", 660, 480, 560, 120, "");
      k.shape(
        "wf-button",
        660,
        630,
        220,
        60,
        t("Start application", "Commencer la demande"),
        { color: PALETTE.blue },
      );
      k.shape(
        "wf-button",
        900,
        630,
        180,
        60,
        t("Learn more", "En savoir plus"),
      );
      [
        t("Child care benefit", "Prestation pour garde d’enfants"),
        t("Child Disability Benefit", "Prestation pour enfants handicapés"),
        t("Family savings plan", "Régime d’épargne familial"),
      ].forEach((text, n) =>
        k.shape("wf-card", 60 + n * 400, 750, 360, 260, text),
      );
      k.text(
        60,
        1050,
        540,
        t("Check your eligibility", "Vérifiez votre admissibilité"),
        { fontSize: 22, bold: true },
      );
      k.shape(
        "wf-input",
        60,
        1100,
        540,
        50,
        t("Full name", "Nom complet"),
        left,
      );
      k.shape("wf-dropdown", 60, 1170, 540, 50, t("Region", "Région"), left);
      k.shape(
        "wf-radio",
        60,
        1240,
        260,
        40,
        t("Married or common-law", "Marié ou conjoint de fait"),
        left,
      );
      k.shape("wf-radio", 340, 1240, 260, 40, t("Single", "Célibataire"), left);
      k.shape(
        "wf-checkbox",
        60,
        1300,
        540,
        40,
        t(
          "I agree to the privacy notice",
          "J’accepte l’avis de confidentialité",
        ),
        left,
      );
      k.shape("wf-button", 60, 1360, 200, 60, t("Submit", "Soumettre"), {
        color: PALETTE.blue,
      });
      k.text(660, 1050, 560, t("Recent updates", "Mises à jour récentes"), {
        fontSize: 22,
        bold: true,
      });
      k.shape("wf-paragraph", 660, 1100, 560, 80, "");
      k.shape("wf-paragraph", 660, 1200, 560, 80, "");
      k.shape("wf-pagination", 660, 1300, 300, 40, "");
      k.card(
        60,
        1460,
        1160,
        140,
        t(
          "Footer: About this service · Contact us · Terms and conditions · Privacy",
          "Pied de page : À propos du service · Contactez-nous · Avis · Confidentialité",
        ),
        { color: PALETTE.grey, fontSize: 14 },
      );
      const markers = [
        [30, 250],
        [630, 610],
        [40, 730],
        [40, 1080],
        [630, 1280],
      ];
      markers.forEach(([x, y], n) =>
        k.shape("ellipse", x, y, 40, 40, String(n + 1), {
          color: PALETTE.orange,
          textAlign: "center",
          fontSize: 16,
          bold: true,
        }),
      );
      k.frame(1320, 140, 420, 1520, t("Annotations", "Annotations"));
      [
        [
          200,
          t(
            "1. Keep the main navigation to five items or fewer",
            "1. Limiter la navigation principale à cinq éléments",
          ),
        ],
        [
          560,
          t(
            "2. One primary action, visible without scrolling",
            "2. Une seule action principale, visible sans défiler",
          ),
        ],
        [
          740,
          t(
            "3. Each card links to a program page",
            "3. Chaque carte mène à la page d’un programme",
          ),
        ],
        [
          1040,
          t(
            "4. Validate fields inline with clear error messages",
            "4. Valider les champs sur place avec des messages d’erreur clairs",
          ),
        ],
        [
          1220,
          t(
            "5. Show 10 updates per page",
            "5. Afficher 10 mises à jour par page",
          ),
        ],
      ].forEach(([y, text]) =>
        k.note(1340, y, text, { w: 380, h: 140, color: PALETTE.yellow }),
      );
      k.note(1340, 1400, t("Add an annotation", "Ajoutez une annotation"), {
        w: 380,
        h: 140,
        color: PALETTE.yellow,
      });
    },
  },
  {
    id: "usability-synthesis",
    category: "ux",
    name: ["Usability testing synthesis", "Synthèse de tests d’utilisabilité"],
    description: [
      "Summarize task success, observations and severity-rated issues into recommendations.",
      "Résumer la réussite des tâches, les observations et les problèmes classés par gravité en recommandations.",
    ],
    keywords: [
      "usability test findings severity issues participants tasks design thinking test",
      "test d’utilisabilité constats gravité problèmes participants tâches pensée design test",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        1940,
        t("Usability testing synthesis", "Synthèse de tests d’utilisabilité"),
      );
      k.text(
        0,
        60,
        1940,
        t(
          "How to use: record results right after each session. Fill the success grid, add one observation per note under its task, rate issues by severity, then agree on recommendations.",
          "Mode d’emploi : consignez les résultats juste après chaque séance. Remplissez la grille de réussite, ajoutez une observation par note sous sa tâche, classez les problèmes par gravité, puis convenez des recommandations.",
        ),
      );
      const pass = t("Pass", "Réussi"),
        fail = t("Fail", "Échec"),
        help = t("Assisted", "Aidé");
      k.frame(0, 160, 900, 360, t("1. Task success", "1. Réussite des tâches"));
      k.table(
        20,
        220,
        860,
        [
          [
            t("Task", "Tâche"),
            "P1",
            "P2",
            "P3",
            "P4",
            "P5",
            t("Success", "Réussite"),
          ],
          [
            t(
              "T1 Find if you are eligible",
              "T1 Savoir si vous êtes admissible",
            ),
            pass,
            pass,
            help,
            pass,
            pass,
            "4/5",
          ],
          [
            t("T2 Upload a document", "T2 Téléverser un document"),
            fail,
            help,
            fail,
            pass,
            fail,
            "1/5",
          ],
          [
            t("T3 Save and return later", "T3 Enregistrer et revenir"),
            pass,
            fail,
            pass,
            pass,
            help,
            "3/5",
          ],
          [
            t(
              "T4 Check application status",
              "T4 Vérifier l’état de la demande",
            ),
            pass,
            pass,
            pass,
            pass,
            pass,
            "5/5",
          ],
        ],
        { columnWidths: [300, 80, 80, 80, 80, 80, 160] },
      );
      k.text(
        20,
        440,
        860,
        t(
          "Pass: completed alone · Assisted: needed a hint · Fail: could not complete",
          "Réussi : sans aide · Aidé : a eu besoin d’un indice · Échec : n’a pas pu terminer",
        ),
        { fontSize: 14 },
      );
      k.frame(
        940,
        160,
        1000,
        360,
        t("2. Issues by severity", "2. Problèmes par gravité"),
      );
      k.table(
        960,
        220,
        960,
        [
          [
            t("Issue", "Problème"),
            t("Severity", "Gravité"),
            t("Task", "Tâche"),
            t("Participants", "Participants"),
          ],
          [
            t(
              "Upload button hidden below the fold on mobile",
              "Bouton de téléversement caché sous le pli sur mobile",
            ),
            t("High", "Élevée"),
            "T2",
            "4 / 5",
          ],
          [
            t(
              "“Save” label unclear: people expected it to submit",
              "Libellé « Enregistrer » ambigu : on croit soumettre",
            ),
            t("Medium", "Moyenne"),
            "T3",
            "2 / 5",
          ],
          [
            t(
              "Eligibility page uses program jargon",
              "La page d’admissibilité utilise le jargon du programme",
            ),
            t("Medium", "Moyenne"),
            "T1",
            "2 / 5",
          ],
          [
            t(
              "Status date format is ambiguous",
              "Le format de date de l’état est ambigu",
            ),
            t("Low", "Faible"),
            "T4",
            "1 / 5",
          ],
        ],
        { columnWidths: [480, 140, 140, 200] },
      );
      k.text(
        960,
        440,
        960,
        t(
          "High: blocks completion · Medium: causes delay or errors · Low: cosmetic",
          "Élevée : empêche de terminer · Moyenne : retards ou erreurs · Faible : esthétique",
        ),
        { fontSize: 14 },
      );
      k.frame(
        0,
        560,
        1940,
        420,
        t("3. Observations by task", "3. Observations par tâche"),
      );
      const tasks = [
        [
          t("T1 Find if you are eligible", "T1 Savoir si vous êtes admissible"),
          [
            t(
              "P3 read the rules twice before starting",
              "P3 a lu les règles deux fois avant de commencer",
            ),
            t(
              "Most scanned for their situation, not the rules",
              "La plupart cherchaient leur situation, pas les règles",
            ),
            t(
              "P1 liked the yes or no questions",
              "P1 a aimé les questions oui ou non",
            ),
          ],
        ],
        [
          t("T2 Upload a document", "T2 Téléverser un document"),
          [
            t(
              "4 of 5 scrolled past the upload button",
              "4 sur 5 ont dépassé le bouton de téléversement",
            ),
            t(
              "P2 did not know which file types work",
              "P2 ne savait pas quels types de fichiers conviennent",
            ),
            t(
              "Phone photos were too large",
              "Les photos du téléphone étaient trop lourdes",
            ),
          ],
        ],
        [
          t("T3 Save and return later", "T3 Enregistrer et revenir"),
          [
            t(
              "P2 expected “Save” to submit the form",
              "P2 pensait que « Enregistrer » soumettait le formulaire",
            ),
            t(
              "No one noticed the confirmation message",
              "Personne n’a remarqué le message de confirmation",
            ),
            t(
              "P5 wanted an email reminder",
              "P5 voulait un rappel par courriel",
            ),
          ],
        ],
        [
          t("T4 Check application status", "T4 Vérifier l’état de la demande"),
          [
            t(
              "Everyone found the status page quickly",
              "Tous ont trouvé la page d’état rapidement",
            ),
            t("P4 read 03/04 as March 4", "P4 a lu 03/04 comme le 3 avril"),
            t(
              "People wanted the next step spelled out",
              "On voulait que la prochaine étape soit précisée",
            ),
          ],
        ],
      ];
      tasks.forEach(([title, notes], n) => {
        const x = 20 + n * 480;
        prompt(k, x, 620, 460, title, 50);
        notes.forEach((text, i) =>
          k.note(x + (i % 2) * 240, 690 + Math.floor(i / 2) * 140, text, {
            w: 220,
            h: 120,
            color: PALETTE.yellow,
          }),
        );
        k.note(
          x + 240,
          830,
          t("Add an observation", "Ajoutez une observation"),
          {
            w: 220,
            h: 120,
            color: PALETTE.yellow,
          },
        );
      });
      k.frame(0, 1020, 940, 340, t("4. Insights", "4. Constats"));
      [
        t(
          "Critical actions must be visible without scrolling on mobile",
          "Les actions essentielles doivent être visibles sans défiler sur mobile",
        ),
        t(
          "People rely on their own words, not program terms",
          "Les gens utilisent leurs mots, pas les termes du programme",
        ),
        t(
          "Reassurance matters as much as speed",
          "Se sentir rassuré compte autant que la rapidité",
        ),
      ].forEach((text, n) =>
        k.note(20 + n * 300, 1080, text, {
          w: 280,
          h: 140,
          color: PALETTE.purple,
        }),
      );
      k.note(20, 1240, t("Add an insight", "Ajoutez un constat"), {
        w: 280,
        h: 100,
        color: PALETTE.purple,
      });
      k.frame(
        980,
        1020,
        960,
        340,
        t("5. Recommendations", "5. Recommandations"),
      );
      k.table(
        1000,
        1080,
        920,
        [
          [
            t("Recommendation", "Recommandation"),
            t("Owner", "Responsable"),
            t("Effort", "Effort"),
          ],
          [
            t(
              "Move the upload button above the fold",
              "Placer le bouton de téléversement au-dessus du pli",
            ),
            t("Design", "Conception"),
            t("Small", "Faible"),
          ],
          [
            t(
              "Rename “Save” to “Save and continue later”",
              "Renommer « Enregistrer » en « Enregistrer et continuer plus tard »",
            ),
            t("Content", "Contenu"),
            t("Small", "Faible"),
          ],
          [
            t(
              "Rewrite eligibility page in plain language",
              "Réécrire la page d’admissibilité en langage clair",
            ),
            t("Content", "Contenu"),
            t("Medium", "Moyen"),
          ],
          ["", "", ""],
        ],
        { columnWidths: [560, 200, 160] },
      );
    },
  },
  {
    id: "design-critique",
    category: "ux",
    name: ["Design critique", "Critique de conception"],
    description: [
      "Run a structured critique with goals, I like, I wish and What if feedback, and decisions.",
      "Animer une critique structurée : objectifs, « J’aime », « J’aimerais », « Et si » et décisions.",
    ],
    keywords: [
      "critique feedback review design crit i like i wish what if",
      "critique rétroaction revue conception j’aime j’aimerais et si",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1400, t("Design critique", "Critique de conception"));
      k.text(
        0,
        60,
        1400,
        t(
          "How to use: the presenter shares the work and the goals (5 min). Everyone adds feedback silently (10 min), then discuss the themes and record decisions (15 min).",
          "Mode d’emploi : la personne présente le travail et les objectifs (5 min). Chacun ajoute ses commentaires en silence (10 min), puis on discute des thèmes et on consigne les décisions (15 min).",
        ),
      );
      k.frame(
        0,
        160,
        860,
        620,
        t("1. Work to critique", "1. Travail à critiquer"),
      );
      k.shape(
        "wf-image",
        20,
        220,
        820,
        380,
        t(
          "Paste a screenshot or link to the design here",
          "Collez ici une capture d’écran ou un lien vers la maquette",
        ),
      );
      k.card(
        20,
        620,
        820,
        140,
        t(
          "Presenter: Jordan · Stage: early concept · Screen: online application, step 2 of 5 · Feedback wanted on: layout and wording",
          "Présentation : Jordan · Étape : concept initial · Écran : demande en ligne, étape 2 de 5 · Commentaires voulus sur : mise en page et formulation",
        ),
        { color: PALETTE.white },
      );
      k.frame(
        900,
        160,
        500,
        620,
        t("2. Goals and ground rules", "2. Objectifs et règles"),
      );
      prompt(
        k,
        920,
        220,
        460,
        t(
          "What is this design trying to achieve?",
          "Que cherche à accomplir cette conception?",
        ),
      );
      k.note(
        920,
        300,
        t(
          "Help applicants finish step 2 without calling us",
          "Aider les demandeurs à terminer l’étape 2 sans nous appeler",
        ),
        { w: 220, h: 140, color: PALETTE.blue },
      );
      k.note(1160, 300, t("Meet WCAG 2.1 AA", "Respecter les WCAG 2.1 AA"), {
        w: 220,
        h: 140,
        color: PALETTE.blue,
      });
      k.card(
        920,
        470,
        460,
        290,
        t(
          "Ground rules\n• Speak to the goals, not personal taste\n• Be specific and point to the screen\n• Suggest, do not prescribe\n• The presenter listens first, then responds",
          "Règles\n• Parler des objectifs, pas des goûts\n• Être précis et montrer l’écran\n• Suggérer, ne pas imposer\n• La personne présente écoute d’abord, puis répond",
        ),
        { color: PALETTE.grey },
      );
      const zones = [
        [
          t("I like", "J’aime"),
          t(
            "What works well and why?",
            "Qu’est-ce qui fonctionne bien et pourquoi?",
          ),
          PALETTE.green,
          [
            t(
              "The progress bar makes the length clear",
              "La barre de progression montre clairement la durée",
            ),
            t("Short, plain questions", "Des questions courtes et simples"),
          ],
        ],
        [
          t("I wish", "J’aimerais"),
          t("What could be improved?", "Qu’est-ce qui pourrait être amélioré?"),
          PALETTE.orange,
          [
            t(
              "The help text were closer to the field",
              "Que le texte d’aide soit plus près du champ",
            ),
            t(
              "The error message said how to fix it",
              "Que le message d’erreur explique comment corriger",
            ),
          ],
        ],
        [
          t("What if", "Et si"),
          t("Ideas to explore next", "Idées à explorer ensuite"),
          PALETTE.purple,
          [
            t(
              "We prefilled data from the last application?",
              "On préremplissait les données de la dernière demande?",
            ),
            t("We split this step in two?", "On divisait cette étape en deux?"),
          ],
        ],
      ];
      zones.forEach(([title, question, color, notes], n) => {
        const x = n * 480;
        k.frame(x, 820, 440, 480, `${n + 3}. ${title}`);
        prompt(k, x + 20, 880, 400, question);
        notes.forEach((text, i) =>
          k.note(x + 20 + i * 210, 960, text, { w: 190, h: 140, color }),
        );
        k.note(x + 20, 1120, t("Add feedback", "Ajoutez un commentaire"), {
          w: 190,
          h: 140,
          color,
        });
      });
      k.frame(
        0,
        1340,
        1400,
        300,
        t("6. Decisions and next steps", "6. Décisions et prochaines étapes"),
      );
      k.table(
        20,
        1400,
        1360,
        [
          [
            t("Decision or action", "Décision ou action"),
            t("Owner", "Responsable"),
            t("Due", "Échéance"),
          ],
          [
            t(
              "Move help text under each field and retest",
              "Déplacer le texte d’aide sous chaque champ et tester de nouveau",
            ),
            "Jordan",
            t("Next sprint", "Prochain sprint"),
          ],
          [
            t(
              "Explore prefilling from previous applications",
              "Explorer le préremplissage à partir des demandes précédentes",
            ),
            t("Product team", "Équipe produit"),
            t("In two weeks", "Dans deux semaines"),
          ],
          ["", "", ""],
          ["", "", ""],
        ],
        { columnWidths: [880, 240, 240] },
      );
    },
  },
  {
    id: "design-thinking",
    category: "ux",
    name: ["Design thinking process", "Processus de pensée design"],
    description: [
      "Take a challenge through the five design thinking stages, from empathy to testing.",
      "Faire passer un défi par les cinq étapes de la pensée design, de l’empathie aux tests.",
    ],
    keywords: [
      "design thinking empathize define ideate prototype test stages process innovation human centred",
      "pensée design empathie définir idéation prototypage test étapes processus innovation centrée sur la personne",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        2160,
        t("Design thinking process", "Processus de pensée design"),
      );
      k.text(
        0,
        60,
        2160,
        t(
          "How to use: agree on the challenge, then work through the stages from left to right. Each stage ends with an output the next one builds on. Testing often sends you back, so loop as often as you need.",
          "Mode d’emploi : convenez du défi, puis franchissez les étapes de gauche à droite. Chaque étape produit un résultat sur lequel s’appuie la suivante. Les tests vous ramènent souvent en arrière : bouclez aussi souvent que nécessaire.",
        ),
      );
      k.frame(0, 140, 2160, 180, t("The challenge", "Le défi"));
      k.card(
        20,
        200,
        1500,
        90,
        t(
          "How might we help first-time applicants finish a benefit application in one sitting?",
          "Comment pourrions-nous aider les personnes qui font une première demande de prestation à la terminer en une seule séance?",
        ),
        { color: PALETTE.blue, fontSize: 20, bold: true },
      );
      k.note(
        1560,
        200,
        t(
          "Team: product, design, policy and call centre",
          "Équipe : produit, design, politiques et centre d’appels",
        ),
        { w: 580, h: 90, color: PALETTE.grey },
      );
      const stages = [
        [
          t("1 · Empathize", "1 · Empathie"),
          t(
            "Who are we designing for, and what do they need?",
            "Pour qui concevons-nous, et de quoi ces personnes ont-elles besoin?",
          ),
          t(
            "Methods: interviews, observation, empathy map, personas",
            "Méthodes : entrevues, observation, carte d’empathie, personas",
          ),
          PALETTE.yellow,
          [
            t(
              "Applicants start on a phone during breaks",
              "Les demandeurs commencent sur leur téléphone pendant leurs pauses",
            ),
            t(
              "Many stop when asked for documents they do not have",
              "Beaucoup abandonnent quand un document leur manque",
            ),
          ],
          t(
            "Output: what we heard and saw",
            "Résultat : ce que nous avons entendu et observé",
          ),
        ],
        [
          t("2 · Define", "2 · Définir"),
          t(
            "What is the real problem to solve?",
            "Quel est le vrai problème à résoudre?",
          ),
          t(
            "Methods: affinity mapping, problem statement, How might we",
            "Méthodes : diagramme d’affinités, énoncé du problème, Comment pourrions-nous",
          ),
          PALETTE.orange,
          [
            t(
              "Applicants cannot tell which documents they need before starting",
              "Les demandeurs ne savent pas quels documents préparer avant de commencer",
            ),
            t(
              "Saving and coming back is hard to find",
              "Il est difficile de trouver comment enregistrer et revenir",
            ),
          ],
          t(
            "Output: How might we help applicants gather what they need before they start?",
            "Résultat : Comment pourrions-nous aider les demandeurs à réunir ce qu’il leur faut avant de commencer?",
          ),
        ],
        [
          t("3 · Ideate", "3 · Idéation"),
          t(
            "What are many ways we could solve it?",
            "De quelles façons pourrions-nous le résoudre?",
          ),
          t(
            "Methods: brainstorming, Crazy 8s, dot voting",
            "Méthodes : remue-méninges, Crazy 8, vote par points",
          ),
          PALETTE.green,
          [
            t(
              "A checklist screen before the form",
              "Un écran de liste de vérification avant le formulaire",
            ),
            t(
              "Text a link to finish later",
              "Envoyer par texto un lien pour terminer plus tard",
            ),
          ],
          t(
            "Output: the ideas to prototype",
            "Résultat : les idées à prototyper",
          ),
        ],
        [
          t("4 · Prototype", "4 · Prototypage"),
          t(
            "What is the quickest way to make an idea real?",
            "Quelle est la façon la plus rapide de concrétiser une idée?",
          ),
          t(
            "Methods: paper sketches, wireframes, storyboards",
            "Méthodes : croquis sur papier, maquettes fonctionnelles, scénarimages",
          ),
          PALETTE.blue,
          [
            t(
              "Paper checklist screen",
              "Écran de liste de vérification sur papier",
            ),
            t(
              "Clickable save and return flow",
              "Parcours cliquable pour enregistrer et revenir",
            ),
          ],
          t(
            "Output: a prototype people can try",
            "Résultat : un prototype que les gens peuvent essayer",
          ),
        ],
        [
          t("5 · Test", "5 · Test"),
          t(
            "What did people do with the prototype?",
            "Qu’ont fait les gens avec le prototype?",
          ),
          t(
            "Methods: usability testing, feedback grid",
            "Méthodes : tests d’utilisabilité, grille de rétroaction",
          ),
          PALETTE.purple,
          [
            t(
              "4 of 5 found the checklist before starting",
              "4 personnes sur 5 ont trouvé la liste avant de commencer",
            ),
            t(
              "Nobody noticed the save link",
              "Personne n’a remarqué le lien d’enregistrement",
            ),
          ],
          t(
            "Output: what to keep, change or drop",
            "Résultat : ce qu’il faut garder, changer ou abandonner",
          ),
        ],
      ];
      stages.forEach(([title, question, methods, color, notes, output], n) => {
        const x = n * 440,
          y = 360;
        k.frame(x, y, 400, 700, title);
        prompt(k, x + 20, y + 60, 360, question, 90);
        k.text(x + 20, y + 170, 360, methods, { fontSize: 14 });
        notes.forEach((text, e) =>
          k.note(x + 20 + e * 190, y + 240, text, { w: 170, h: 150, color }),
        );
        k.note(x + 20, y + 410, t("Add yours", "Ajoutez les vôtres"), {
          w: 170,
          h: 150,
          color,
        });
        k.card(x + 20, y + 580, 360, 100, output, {
          color: PALETTE.white,
          textAlign: "left",
        });
      });
      k.frame(0, 1100, 2160, 220, t("Iterate", "Itérer"));
      k.card(
        20,
        1160,
        900,
        120,
        t(
          "Design thinking is not a straight line. Take what you learned back to any stage, then test again.",
          "La pensée design n’est pas linéaire. Ramenez ce que vous avez appris à n’importe quelle étape, puis testez de nouveau.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
      [
        t(
          "Back to Prototype: make the save link visible",
          "Retour au prototypage : rendre le lien d’enregistrement visible",
        ),
        t(
          "Back to Empathize: talk with applicants who use screen readers",
          "Retour à l’empathie : parler avec des demandeurs qui utilisent un lecteur d’écran",
        ),
      ].forEach((text, n) =>
        k.note(960 + n * 600, 1160, text, {
          w: 560,
          h: 120,
          color: PALETTE.purple,
        }),
      );
    },
  },
];
