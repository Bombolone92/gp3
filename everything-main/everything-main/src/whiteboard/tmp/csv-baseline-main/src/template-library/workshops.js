import { PALETTE } from "./kit.js";
// Tables take their height from explicit row heights.
const table = (k, x, y, w, cells, columnWidths, rowHeights) =>
  k.table(x, y, w, cells, {
    columnWidths,
    ...(rowHeights
      ? { rowHeights, h: rowHeights.reduce((a, b) => a + b, 0) }
      : {}),
  });
const dot = (k, x, y) =>
  k.shape("ellipse", x, y, 30, 30, "", { color: PALETTE.navy });
// Agenda summary under the heading: one column per step with its timing.
function overview(k, y, w, steps) {
  const { t } = k,
    first = 140,
    column = (w - first) / steps.length;
  table(
    k,
    0,
    y,
    w,
    [
      [t("Step", "Étape"), ...steps.map(([title], n) => `${n + 1} · ${title}`)],
      [t("Time", "Durée"), ...steps.map(([, minutes]) => `${minutes} min`)],
    ],
    [first, ...steps.map(() => column)],
    [60, 40],
  );
}
// A playbook step: frame titled with its number and timing, a timebox note,
// and a facilitator script. Returns the activity area below the script.
function step(k, x, y, w, h, n, title, minutes, script) {
  const { t } = k;
  k.frame(x, y, w, h, `${n} · ${title} (${minutes} min)`);
  k.note(
    x + 20,
    y + 60,
    t(`Timebox: ${minutes} min`, `Durée : ${minutes} min`),
    {
      w: 200,
      h: 60,
      color: PALETTE.orange,
    },
  );
  k.card(x + 20, y + 140, w - 40, 100, script, {
    color: PALETTE.grey,
    textAlign: "left",
  });
  return { x: x + 20, y: y + 260, w: w - 40 };
}
// Places a list of [text, color] notes in rows of two within an activity area.
function notes(k, area, list, { w = 200, h = 120 } = {}) {
  list.forEach(([text, color], n) =>
    k.note(
      area.x + (n % 2) * (w + 20),
      area.y + Math.floor(n / 2) * (h + 20),
      text,
      {
        w,
        h,
        color,
      },
    ),
  );
}
// Lays out step frames in a grid, left to right then top to bottom.
function steps(k, top, columns, w, h, list) {
  const t = k.t;
  return list.map(([title, minutes, script], n) =>
    step(
      k,
      (n % columns) * (w + 40),
      top + Math.floor(n / columns) * (h + 40),
      w,
      h,
      n + 1,
      title,
      minutes,
      t("Facilitator: ", "Animation : ") + script,
    ),
  );
}
export default [
  {
    id: "brainstorm",
    category: "workshops",
    name: ["Brainstorming", "Remue-méninges"],
    description: [
      "Generate many ideas around a How might we question, then vote.",
      "Générer beaucoup d’idées autour d’une question « Comment pourrions-nous », puis voter.",
    ],
    keywords: [
      "ideation ideas how might we dot voting",
      "idéation idées comment pourrions-nous vote par points",
    ],
    build(k) {
      const { t } = k,
        { yellow, green, blue, purple, grey } = PALETTE;
      k.heading(0, 0, 1220, t("Brainstorming", "Remue-méninges"));
      k.text(
        0,
        60,
        1220,
        t(
          "Frame the question, spend 10 minutes adding ideas silently, share them, then give everyone three dots to vote.",
          "Formulez la question, ajoutez des idées en silence pendant 10 minutes, partagez-les, puis donnez trois points à chaque personne pour voter.",
        ),
      );
      k.frame(0, 140, 760, 240, t("How might we", "Comment pourrions-nous"));
      k.card(
        20,
        200,
        720,
        140,
        t(
          "How might we help newcomers find the government services they qualify for in their first month?",
          "Comment pourrions-nous aider les nouveaux arrivants à trouver les services gouvernementaux auxquels ils ont droit pendant leur premier mois?",
        ),
        { color: blue, fontSize: 22, bold: true },
      );
      k.frame(800, 140, 420, 240, t("Rules", "Règles"));
      k.card(
        820,
        200,
        380,
        160,
        t(
          "Defer judgment\nGo for quantity\nBuild on others’ ideas\nOne idea per note\nStay on topic",
          "Suspendez le jugement\nVisez la quantité\nBâtissez sur les idées des autres\nUne idée par note\nRestez dans le sujet",
        ),
        { color: grey, textAlign: "left" },
      );
      const zones = [
        [
          t("Obvious ideas", "Idées évidentes"),
          yellow,
          [
            t(
              "Welcome checklist on Canada.ca",
              "Liste d’accueil sur Canada.ca",
            ),
            t(
              "Information sessions in libraries",
              "Séances d’information en bibliothèque",
            ),
            t(
              "Services explained in many languages",
              "Services expliqués en plusieurs langues",
            ),
          ],
        ],
        [
          t("Bold ideas", "Idées audacieuses"),
          green,
          [
            t(
              "One sign-up for federal and provincial services",
              "Une seule inscription aux services fédéraux et provinciaux",
            ),
            t(
              "Service navigator at the airport",
              "Accompagnateur de services à l’aéroport",
            ),
            t(
              "Text message reminders for key deadlines",
              "Rappels par texto pour les échéances clés",
            ),
          ],
        ],
        [
          t("Wild ideas", "Idées folles"),
          purple,
          [
            t(
              "Benefits start automatically on arrival",
              "Les prestations commencent automatiquement à l’arrivée",
            ),
            t(
              "A buddy from the community for 30 days",
              "Un parrain de la communauté pendant 30 jours",
            ),
            t("Add your idea", "Ajoutez votre idée"),
          ],
        ],
      ];
      zones.forEach(([title, color, list], n) => {
        const x = n * 420;
        k.frame(x, 420, 380, 440, title);
        list.forEach((text, e) =>
          k.note(x + 20 + (e % 2) * 180, 480 + Math.floor(e / 2) * 160, text, {
            w: 160,
            h: 140,
            color,
          }),
        );
        k.note(x + 200, 640, t("Add your idea", "Ajoutez votre idée"), {
          w: 160,
          h: 140,
          color,
        });
      });
      k.frame(0, 900, 1220, 240, t("Dot voting", "Vote par points"));
      k.card(
        20,
        960,
        480,
        140,
        t(
          "Each person gets three dots. Copy a dot next to the ideas you would test first. Discuss the top three.",
          "Chaque personne reçoit trois points. Copiez un point à côté des idées à tester en premier. Discutez des trois premières.",
        ),
        { color: grey, textAlign: "left" },
      );
      for (let n = 0; n < 6; n++) dot(k, 540 + n * 50, 1010);
      k.note(
        880,
        960,
        t(
          "Top idea: one sign-up for all services",
          "Idée retenue : une seule inscription à tous les services",
        ),
        {
          w: 320,
          h: 140,
          color: green,
        },
      );
    },
  },
  {
    id: "crazy-8s",
    category: "workshops",
    name: ["Crazy 8s", "Crazy 8"],
    description: [
      "Sketch eight ideas in eight minutes, then share and vote.",
      "Esquisser huit idées en huit minutes, puis les partager et voter.",
    ],
    keywords: [
      "sketching design sprint rapid ideation",
      "esquisse sprint de conception idéation rapide",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1320, t("Crazy 8s", "Crazy 8"));
      k.text(
        0,
        60,
        1320,
        t(
          "Fold a sheet into eight panels or use the panels below. Set a timer: one minute per sketch, no erasing. Quantity beats polish.",
          "Pliez une feuille en huit ou utilisez les cases ci-dessous. Réglez une minuterie : une minute par esquisse, sans effacer. La quantité l’emporte sur la finition.",
        ),
      );
      k.frame(0, 140, 1320, 200, t("The challenge", "Le défi"));
      k.card(
        20,
        200,
        980,
        100,
        t(
          "Sketch ways an applicant could check the status of their application on a phone.",
          "Esquissez des façons pour un demandeur de vérifier l’état de sa demande sur un téléphone.",
        ),
        { color: PALETTE.blue, fontSize: 20, bold: true },
      );
      k.note(
        1020,
        200,
        t(
          "8 min in total · 1 min per panel",
          "8 min au total · 1 min par case",
        ),
        {
          w: 280,
          h: 100,
          color: PALETTE.orange,
        },
      );
      for (let n = 0; n < 8; n++) {
        const x = (n % 4) * 340,
          y = 380 + Math.floor(n / 4) * 300;
        k.frame(
          x,
          y,
          300,
          260,
          t(`Sketch ${n + 1} · 1 min`, `Esquisse ${n + 1} · 1 min`),
        );
        k.card(
          x + 20,
          y + 60,
          260,
          180,
          n === 0
            ? t(
                "Example: a status timeline with the current step highlighted",
                "Exemple : une ligne du temps avec l’étape en cours mise en évidence",
              )
            : t("Sketch here", "Esquissez ici"),
          { color: n === 0 ? PALETTE.yellow : PALETTE.white },
        );
      }
      k.frame(0, 980, 1320, 260, t("Share and vote", "Partager et voter"));
      k.card(
        20,
        1040,
        620,
        160,
        t(
          "Present your sketches in 1 minute each. Everyone places two dots on the ideas to develop into a storyboard.",
          "Présentez vos esquisses en 1 minute chacune. Chaque personne place deux points sur les idées à développer en scénarimage.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
      for (let n = 0; n < 4; n++) dot(k, 680 + n * 50, 1100);
      k.note(
        900,
        1040,
        t(
          "Chosen idea: status timeline with notifications",
          "Idée retenue : ligne du temps avec notifications",
        ),
        {
          w: 400,
          h: 160,
          color: PALETTE.green,
        },
      );
    },
  },
  {
    id: "icebreaker",
    category: "workshops",
    name: ["Icebreakers", "Activités brise-glace"],
    description: [
      "Warm up a session with quick, inclusive activities.",
      "Réchauffer une séance avec des activités rapides et inclusives.",
    ],
    keywords: [
      "warm up energizer check-in team building",
      "réchauffement énergisant tour de table cohésion",
    ],
    build(k) {
      const { t } = k,
        { grey, blue, green, yellow, purple } = PALETTE;
      k.heading(0, 0, 1280, t("Icebreakers", "Activités brise-glace"));
      k.text(
        0,
        60,
        1280,
        t(
          "Pick one or two activities to open a session. Keep them short, optional, and inclusive for people joining remotely.",
          "Choisissez une ou deux activités pour ouvrir une séance. Gardez-les courtes, facultatives et inclusives pour les personnes à distance.",
        ),
      );
      // Mood check
      k.frame(
        0,
        140,
        620,
        500,
        t("Mood check · 3 min", "Humeur du jour · 3 min"),
      );
      k.card(
        20,
        200,
        580,
        60,
        t(
          "How are you arriving today? Place a dot under your mood.",
          "Comment arrivez-vous aujourd’hui? Placez un point sous votre humeur.",
        ),
        {
          color: grey,
          textAlign: "left",
        },
      );
      [
        ["emotion-high", t("Energized", "Plein d’énergie"), green],
        ["emotion-neutral", t("Okay", "Correct"), yellow],
        ["emotion-low", t("Tired", "Fatigué"), PALETTE.orange],
      ].forEach(([key, label, color], n) => {
        const x = 40 + n * 200;
        k.shape(key, x + 20, 280, 120, 120, "", { color });
        k.shape("terminator", x, 420, 160, 40, label, { color: grey });
      });
      dot(k, 90, 490);
      dot(k, 130, 490);
      dot(k, 290, 490);
      dot(k, 490, 490);
      // Where are you joining from
      k.frame(
        660,
        140,
        620,
        500,
        t(
          "Where are you joining from? · 3 min",
          "D’où participez-vous? · 3 min",
        ),
      );
      k.card(
        680,
        200,
        580,
        60,
        t("Place a dot on your region.", "Placez un point sur votre région."),
        {
          color: grey,
          textAlign: "left",
        },
      );
      k.card(680, 280, 580, 80, t("The North", "Le Nord"), { color: blue });
      [
        [t("British Columbia", "Colombie-Britannique"), green],
        [t("Prairies", "Prairies"), yellow],
        [t("Ontario", "Ontario"), purple],
        [t("Quebec", "Québec"), blue],
        [t("Atlantic Canada", "Canada atlantique"), green],
        [t("Outside Canada", "Hors du Canada"), grey],
      ].forEach(([label, color], n) =>
        k.card(
          680 + (n % 3) * 200,
          380 + Math.floor(n / 3) * 120,
          180,
          100,
          label,
          { color },
        ),
      );
      dot(k, 1030, 320);
      dot(k, 900, 440);
      dot(k, 940, 440);
      dot(k, 720, 550);
      // Two truths and a lie
      k.frame(
        0,
        680,
        620,
        500,
        t(
          "Two truths and a lie · 10 min",
          "Deux vérités et un mensonge · 10 min",
        ),
      );
      k.card(
        20,
        740,
        580,
        80,
        t(
          "Write three statements about yourself, one of them false. Others guess the lie.",
          "Écrivez trois énoncés sur vous, dont un faux. Les autres devinent le mensonge.",
        ),
        { color: grey, textAlign: "left" },
      );
      [
        t(
          "I have visited all 13 provinces and territories",
          "J’ai visité les 13 provinces et territoires",
        ),
        t("I can paddle a canoe solo", "Je sais pagayer seul en canot"),
        t("I once met an astronaut", "J’ai déjà rencontré un astronaute"),
      ].forEach((text, n) =>
        k.note(20 + n * 200, 840, text, { w: 180, h: 140, color: yellow }),
      );
      k.note(20, 1000, t("Your three statements", "Vos trois énoncés"), {
        w: 180,
        h: 140,
        color: grey,
      });
      // One word check-in
      k.frame(
        660,
        680,
        620,
        500,
        t("One-word check-in · 2 min", "Un mot pour commencer · 2 min"),
      );
      k.card(
        680,
        740,
        580,
        80,
        t(
          "Describe how you feel about today’s topic in one word.",
          "Décrivez en un mot ce que vous inspire le sujet du jour.",
        ),
        {
          color: grey,
          textAlign: "left",
        },
      );
      [
        [t("Curious", "Curieux"), blue],
        [t("Focused", "Concentré"), green],
        [t("Hopeful", "Optimiste"), purple],
        [t("Your word", "Votre mot"), grey],
      ].forEach(([text, color], n) =>
        k.note(680 + (n % 3) * 200, 840 + Math.floor(n / 3) * 160, text, {
          w: 180,
          h: 140,
          color,
        }),
      );
    },
  },
  {
    id: "workshop",
    category: "workshops",
    name: ["Workshop agenda", "Programme d’atelier"],
    description: [
      "Plan goals, participants, timing, and materials for a session.",
      "Planifier les objectifs, les participants, le minutage et le matériel d’une séance.",
    ],
    keywords: [
      "agenda meeting plan facilitation schedule",
      "ordre du jour réunion plan animation horaire",
    ],
    build(k) {
      const { t } = k,
        { blue, green, yellow, grey, purple } = PALETTE;
      k.heading(0, 0, 1600, t("Workshop agenda", "Programme d’atelier"));
      k.text(
        0,
        60,
        1600,
        t(
          "Share this board with participants before the session. Agree on the outcomes first, then plan activities that lead to them.",
          "Communiquez ce tableau aux participants avant la séance. Convenez d’abord des résultats, puis planifiez les activités qui y mènent.",
        ),
      );
      k.frame(
        0,
        140,
        560,
        300,
        t("Goals and outcomes", "Objectifs et résultats"),
      );
      [
        t(
          "Shared understanding of the current journey",
          "Vision commune du parcours actuel",
        ),
        t("Top three pain points agreed", "Trois principaux irritants retenus"),
        t("Owners for next steps", "Responsables des prochaines étapes"),
      ].forEach((text, n) =>
        k.note(20 + n * 180, 200, text, { w: 160, h: 140, color: green }),
      );
      k.frame(
        600,
        140,
        560,
        300,
        t("Participants and roles", "Participants et rôles"),
      );
      [
        [t("Facilitator: Léa", "Animation : Léa"), blue],
        [
          t(
            "Decision maker: program director",
            "Décision : direction du programme",
          ),
          purple,
        ],
        [t("Note taker: Sam", "Prise de notes : Sam"), yellow],
        [
          t(
            "Subject matter experts: 4 people",
            "Experts en la matière : 4 personnes",
          ),
          grey,
        ],
      ].forEach(([text, color], n) =>
        k.card(
          620 + (n % 2) * 270,
          200 + Math.floor(n / 2) * 110,
          250,
          90,
          text,
          { color },
        ),
      );
      k.frame(0, 480, 1160, 480, t("Agenda", "Déroulement"));
      table(
        k,
        20,
        540,
        1120,
        [
          [
            t("Time", "Heure"),
            t("Activity", "Activité"),
            t("Owner", "Responsable"),
            t("Outcome", "Résultat"),
          ],
          [
            t("9:00", "9 h"),
            t("Welcome and icebreaker", "Accueil et brise-glace"),
            "Léa",
            t("Everyone introduced", "Tout le monde s’est présenté"),
          ],
          [
            t("9:15", "9 h 15"),
            t("Goals and agenda", "Objectifs et programme"),
            t("Director", "Direction"),
            t("Shared purpose", "Objectif commun"),
          ],
          [
            t("9:30", "9 h 30"),
            t("Map the current journey", "Cartographier le parcours actuel"),
            t("All", "Tous"),
            t("Journey map draft", "Ébauche de carte de parcours"),
          ],
          [t("10:15", "10 h 15"), t("Break", "Pause"), "", ""],
          [
            t("10:30", "10 h 30"),
            t(
              "Identify pain points and vote",
              "Relever les irritants et voter",
            ),
            t("All", "Tous"),
            t("Top three pain points", "Trois principaux irritants"),
          ],
          [
            t("11:15", "11 h 15"),
            t("Next steps and owners", "Prochaines étapes et responsables"),
            "Sam",
            t("Action list", "Liste d’actions"),
          ],
          [
            t("11:45", "11 h 45"),
            t("Check-out", "Tour de clôture"),
            "Léa",
            t("Feedback", "Rétroaction"),
          ],
          ["", "", "", ""],
        ],
        [140, 400, 220, 360],
      );
      k.frame(
        1200,
        140,
        400,
        360,
        t("Materials and preparation", "Matériel et préparation"),
      );
      k.card(
        1220,
        200,
        360,
        260,
        t(
          "Book a room with a screen\nShare the board link a day ahead\nPrepare research highlights\nCheck accessibility needs\nSet up the timer",
          "Réserver une salle avec écran\nEnvoyer le lien du tableau la veille\nPréparer les faits saillants de la recherche\nVérifier les besoins d’accessibilité\nPréparer la minuterie",
        ),
        { color: grey, textAlign: "left" },
      );
      k.frame(1200, 540, 400, 420, t("Parking lot", "Stationnement"));
      k.card(
        1220,
        600,
        360,
        60,
        t(
          "Park off-topic questions here to revisit later.",
          "Notez ici les questions hors sujet à revoir plus tard.",
        ),
        {
          color: grey,
          textAlign: "left",
        },
      );
      k.note(
        1220,
        680,
        t(
          "Can we include provincial partners?",
          "Peut-on inclure les partenaires provinciaux?",
        ),
        {
          w: 170,
          h: 140,
          color: yellow,
        },
      );
      k.note(
        1410,
        680,
        t(
          "Budget for research recruitment",
          "Budget pour le recrutement en recherche",
        ),
        {
          w: 170,
          h: 140,
          color: yellow,
        },
      );
    },
  },
  {
    id: "project-kickoff",
    category: "workshops",
    playbook: true,
    name: ["Project kickoff", "Lancement de projet"],
    description: [
      "A step-by-step playbook to align a new team on goals, scope, and roles.",
      "Un guide étape par étape pour aligner une nouvelle équipe sur les objectifs, la portée et les rôles.",
    ],
    keywords: [
      "kick-off start project charter team alignment",
      "démarrage projet charte équipe alignement",
    ],
    build(k) {
      const { t } = k,
        { yellow, green, blue, orange, purple, grey } = PALETTE;
      const list = [
        [
          t("Welcome and introductions", "Accueil et présentations"),
          10,
          t(
            "go around the room: name, role, and one hope for this project.",
            "faites un tour de table : nom, rôle et un espoir pour ce projet.",
          ),
        ],
        [
          t("Why we are here", "Pourquoi nous sommes ici"),
          15,
          t(
            "present the problem and the outcomes. Ask: what would success look like in six months?",
            "présentez le problème et les résultats visés. Demandez : à quoi ressemblerait la réussite dans six mois?",
          ),
        ],
        [
          t("Scope in and out", "Portée : inclus et exclu"),
          15,
          t(
            "sort ideas into in scope and out of scope. Park anything the group cannot agree on.",
            "classez les idées entre inclus et exclu. Mettez de côté tout désaccord.",
          ),
        ],
        [
          t("Roles and RACI", "Rôles et RACI"),
          15,
          t(
            "for each key activity, agree who is responsible, accountable, consulted, and informed.",
            "pour chaque activité clé, déterminez qui est responsable, qui approuve, qui est consulté et qui est informé.",
          ),
        ],
        [
          t("Ways of working", "Façons de travailler"),
          10,
          t(
            "agree on rituals, tools, and how decisions are made and recorded.",
            "convenez des rituels, des outils et de la façon de prendre et consigner les décisions.",
          ),
        ],
        [
          t("Risks and questions", "Risques et questions"),
          15,
          t(
            "ask each person to add one risk and one open question, then group them.",
            "demandez à chacun d’ajouter un risque et une question, puis regroupez-les.",
          ),
        ],
        [
          t("Next steps", "Prochaines étapes"),
          10,
          t(
            "capture actions with an owner and a date. Close with a quick confidence vote.",
            "notez les actions avec un responsable et une date. Terminez par un vote de confiance rapide.",
          ),
        ],
      ];
      k.heading(
        0,
        0,
        1960,
        t("Project kickoff playbook", "Guide de lancement de projet"),
      );
      k.text(
        0,
        60,
        1960,
        t(
          "90 minutes. Present each frame in order; the timebox and facilitator script are in every step.",
          "90 minutes. Présentez chaque cadre dans l’ordre; la durée et le texte d’animation figurent à chaque étape.",
        ),
      );
      overview(
        k,
        120,
        1960,
        list.map(([title, minutes]) => [title, minutes]),
      );
      const areas = steps(k, 260, 4, 460, 560, list);
      notes(k, areas[0], [
        [
          t(
            "Priya · Product owner · Hope: launch by spring",
            "Priya · Responsable du produit · Espoir : lancer au printemps",
          ),
          yellow,
        ],
        [
          t(
            "Sam · Developer · Hope: fewer handoffs",
            "Sam · Développeur · Espoir : moins de transferts",
          ),
          yellow,
        ],
        [
          t(
            "Léa · Designer · Hope: test with real users early",
            "Léa · Conceptrice · Espoir : tester tôt avec de vrais utilisateurs",
          ),
          yellow,
        ],
        [t("Add yourself", "Ajoutez-vous"), grey],
      ]);
      k.card(
        areas[1].x,
        areas[1].y,
        420,
        100,
        t(
          "Problem: 40% of online applications are abandoned before submission.",
          "Problème : 40 % des demandes en ligne sont abandonnées avant l’envoi.",
        ),
        {
          color: orange,
        },
      );
      notes(
        k,
        { ...areas[1], y: areas[1].y + 120 },
        [
          [
            t(
              "Goal: halve abandonment by year end",
              "Objectif : réduire de moitié les abandons d’ici la fin de l’année",
            ),
            green,
          ],
          [
            t("Goal: meet WCAG 2.1 AA", "Objectif : respecter les WCAG 2.1 AA"),
            green,
          ],
        ],
        { h: 100 },
      );
      const a2 = areas[2];
      k.shape("terminator", a2.x, a2.y, 200, 40, t("In scope", "Inclus"), {
        color: green,
      });
      k.shape(
        "terminator",
        a2.x + 220,
        a2.y,
        200,
        40,
        t("Out of scope", "Exclu"),
        { color: orange },
      );
      notes(
        k,
        { ...a2, y: a2.y + 60 },
        [
          [
            t("Online application form", "Formulaire de demande en ligne"),
            green,
          ],
          [t("Paper form redesign", "Refonte du formulaire papier"), orange],
          [t("Status notifications", "Avis sur l’état"), green],
          [
            t("Payment system changes", "Changements au système de paiement"),
            orange,
          ],
        ],
        { h: 90 },
      );
      table(
        k,
        areas[3].x,
        areas[3].y,
        420,
        [
          [t("Activity", "Activité"), "R", "A", "C", "I"],
          [
            t("User research", "Recherche"),
            "Léa",
            "Priya",
            "Sam",
            t("Team", "Équipe"),
          ],
          [t("Build", "Développement"), "Sam", "Priya", "Léa", "DG"],
          [
            t("Release", "Mise en service"),
            "Priya",
            "DG",
            t("IT", "TI"),
            t("All", "Tous"),
          ],
          [
            t("Budget", "Budget"),
            "Priya",
            "DG",
            t("Finance", "Finances"),
            t("Team", "Équipe"),
          ],
        ],
        // The C column fits the French "Finances" on one line.
        [130, 70, 70, 80, 70],
        [40, 56, 56, 56, 56],
      );
      notes(k, areas[4], [
        [t("Stand-up daily at 9:30", "Mêlée quotidienne à 9 h 30"), blue],
        [t("Two-week sprints", "Sprints de deux semaines"), blue],
        [
          t(
            "Decisions logged on this board",
            "Décisions consignées sur ce tableau",
          ),
          blue,
        ],
        [
          t("Core hours 10:00 to 15:00", "Heures communes de 10 h à 15 h"),
          blue,
        ],
      ]);
      notes(k, areas[5], [
        [
          t(
            "Risk: key expert leaves in June",
            "Risque : l’experte clé part en juin",
          ),
          orange,
        ],
        [
          t("Risk: legacy API is slow", "Risque : l’ancienne API est lente"),
          orange,
        ],
        [
          t(
            "Question: who approves content?",
            "Question : qui approuve le contenu?",
          ),
          purple,
        ],
        [
          t(
            "Question: which languages at launch?",
            "Question : quelles langues au lancement?",
          ),
          purple,
        ],
      ]);
      table(
        k,
        areas[6].x,
        areas[6].y,
        420,
        [
          [t("Action", "Action"), t("Owner", "Responsable"), t("Date", "Date")],
          [
            t("Book user interviews", "Planifier des entrevues"),
            "Léa",
            t("Friday", "Vendredi"),
          ],
          [
            t("Set up the backlog", "Créer le carnet"),
            "Priya",
            t("Monday", "Lundi"),
          ],
          [
            t("Access to test environment", "Accès à l’environnement de test"),
            "Sam",
            t("Next week", "Semaine prochaine"),
          ],
          ["", "", ""],
        ],
        [200, 120, 100],
        [40, 56, 56, 56, 56],
      );
    },
  },
  {
    id: "lightning-decision-jam",
    category: "workshops",
    playbook: true,
    name: ["Lightning Decision Jam", "Lightning Decision Jam"],
    description: [
      "A one-hour playbook to move from problems to actionable solutions.",
      "Un guide d’une heure pour passer des problèmes à des solutions concrètes.",
    ],
    keywords: [
      "ldj decision problem solving dot vote effort impact",
      "décision résolution de problèmes vote par points effort impact",
    ],
    build(k) {
      const { t } = k,
        { orange, green, blue, grey, yellow } = PALETTE;
      const list = [
        [
          t("Start with problems", "Commencer par les problèmes"),
          7,
          t(
            "everyone writes problems silently, one per note. No solutions yet.",
            "chacun écrit des problèmes en silence, un par note. Pas encore de solutions.",
          ),
        ],
        [
          t("Present problems", "Présenter les problèmes"),
          4,
          t(
            "each person reads their notes aloud in 30 seconds. No discussion.",
            "chaque personne lit ses notes à voix haute en 30 secondes. Aucune discussion.",
          ),
        ],
        [
          t("Select problems to solve", "Choisir les problèmes"),
          6,
          t(
            "give everyone three dots. Vote silently, then rank the problems by votes.",
            "donnez trois points à chacun. Votez en silence, puis classez les problèmes par votes.",
          ),
        ],
        [
          t("Reframe as How might we", "Reformuler la question"),
          6,
          t(
            "rewrite the top problems as How might we questions.",
            "reformulez les principaux problèmes en questions « Comment pourrions-nous ».",
          ),
        ],
        [
          t("Produce solutions", "Produire des solutions"),
          7,
          t(
            "write as many solutions as possible, silently. Quantity over quality.",
            "écrivez le plus de solutions possible, en silence. La quantité avant la qualité.",
          ),
        ],
        [
          t("Prioritize solutions", "Prioriser les solutions"),
          10,
          t(
            "place each solution on the effort and impact grid. Discuss only placement.",
            "placez chaque solution sur la grille effort et impact. Discutez seulement du placement.",
          ),
        ],
        [
          t("Decide what to execute", "Décider quoi réaliser"),
          5,
          t(
            "the decision maker picks the high impact, low effort solutions to try.",
            "la personne responsable choisit les solutions à fort impact et faible effort.",
          ),
        ],
        [
          t("Turn into actionable tasks", "Transformer en tâches"),
          10,
          t(
            "break each chosen solution into small tasks with an owner and a date.",
            "découpez chaque solution retenue en petites tâches avec un responsable et une date.",
          ),
        ],
      ];
      k.heading(
        0,
        0,
        1960,
        t("Lightning Decision Jam", "Lightning Decision Jam"),
      );
      k.text(
        0,
        60,
        1960,
        t(
          "55 minutes, no discussion until the end. Present each frame in order and run the timer for every step.",
          "55 minutes, aucune discussion avant la fin. Présentez chaque cadre dans l’ordre et lancez la minuterie à chaque étape.",
        ),
      );
      overview(
        k,
        120,
        1960,
        list.map(([title, minutes]) => [title, minutes]),
      );
      const a = steps(k, 260, 4, 460, 560, list);
      notes(k, a[0], [
        [t("Too many approval steps", "Trop d’étapes d’approbation"), orange],
        [
          t(
            "Nobody owns the intake form",
            "Personne n’est responsable du formulaire",
          ),
          orange,
        ],
        [
          t(
            "Clients call to check status",
            "Les clients appellent pour connaître l’état",
          ),
          orange,
        ],
        [t("Add a problem", "Ajoutez un problème"), grey],
      ]);
      k.card(
        a[1].x,
        a[1].y,
        420,
        100,
        t(
          "Listen and read along. Questions wait until later.",
          "Écoutez et lisez. Les questions attendront.",
        ),
        {
          color: blue,
        },
      );
      notes(
        k,
        { ...a[1], y: a[1].y + 120 },
        [
          [t("30 s per person", "30 s par personne"), yellow],
          [t("No debate", "Pas de débat"), yellow],
        ],
        { h: 100 },
      );
      notes(
        k,
        a[2],
        [
          [
            t(
              "Clients call to check status",
              "Les clients appellent pour connaître l’état",
            ),
            orange,
          ],
          [t("Too many approval steps", "Trop d’étapes d’approbation"), orange],
        ],
        { h: 140 },
      );
      [0, 40, 80].forEach((dx) => dot(k, a[2].x + 20 + dx, a[2].y + 160));
      dot(k, a[2].x + 240, a[2].y + 160);
      const problem = k.note(
        a[3].x,
        a[3].y,
        t(
          "Clients call to check status",
          "Les clients appellent pour connaître l’état",
        ),
        {
          w: 200,
          h: 100,
          color: orange,
        },
      );
      const hmw = k.card(
        a[3].x,
        a[3].y + 160,
        420,
        100,
        t(
          "How might we let clients see their status without calling?",
          "Comment pourrions-nous permettre aux clients de voir l’état sans appeler?",
        ),
        {
          color: green,
          bold: true,
        },
      );
      k.connect(problem, hmw);
      notes(k, a[4], [
        [
          t(
            "Status page in the online account",
            "Page d’état dans le compte en ligne",
          ),
          green,
        ],
        [t("Text message at each step", "Texto à chaque étape"), green],
        [t("Estimated decision date", "Date de décision estimée"), green],
        [t("Chatbot for status", "Agent conversationnel pour l’état"), green],
      ]);
      const quadrants = [
        [
          t(
            "High impact, low effort: do first",
            "Fort impact, faible effort : à faire d’abord",
          ),
          green,
        ],
        [
          t(
            "High impact, high effort: plan",
            "Fort impact, effort élevé : à planifier",
          ),
          blue,
        ],
        [
          t(
            "Low impact, low effort: maybe",
            "Faible impact, faible effort : peut-être",
          ),
          yellow,
        ],
        [
          t(
            "Low impact, high effort: avoid",
            "Faible impact, effort élevé : à éviter",
          ),
          grey,
        ],
      ];
      quadrants.forEach(([text, color], n) =>
        k.card(
          a[5].x + (n % 2) * 220,
          a[5].y + Math.floor(n / 2) * 140,
          200,
          120,
          text,
          { color },
        ),
      );
      k.card(
        a[6].x,
        a[6].y,
        420,
        100,
        t(
          "Chosen: status page and estimated decision date",
          "Retenu : page d’état et date de décision estimée",
        ),
        {
          color: green,
          bold: true,
        },
      );
      k.shape("star", a[6].x + 160, a[6].y + 120, 100, 100, "", {
        color: yellow,
      });
      table(
        k,
        a[7].x,
        a[7].y,
        420,
        [
          [t("Task", "Tâche"), t("Owner", "Responsable"), t("Due", "Échéance")],
          [
            t("Sketch the status page", "Esquisser la page d’état"),
            "Léa",
            t("Tue", "Mar."),
          ],
          [
            t(
              "Check data for date estimates",
              "Vérifier les données d’estimation",
            ),
            "Sam",
            t("Wed", "Mer."),
          ],
          [
            t("Test with five clients", "Tester avec cinq clients"),
            "Priya",
            t("Fri", "Ven."),
          ],
          ["", "", ""],
        ],
        [200, 120, 100],
        [40, 56, 56, 56, 56],
      );
    },
  },
  {
    id: "playbook-retro",
    category: "workshops",
    playbook: true,
    name: ["Retrospective playbook", "Guide de rétrospective"],
    description: [
      "Facilitate a full retrospective in five timed steps.",
      "Animer une rétrospective complète en cinq étapes minutées.",
    ],
    keywords: [
      "retro sprint agile facilitation continuous improvement",
      "rétro sprint agile animation amélioration continue",
    ],
    build(k) {
      const { t } = k,
        { green, orange, blue, purple, yellow, grey } = PALETTE;
      const list = [
        [
          t("Set the stage", "Préparer le terrain"),
          10,
          t(
            "state the goal, review the working agreement, and run a quick weather check.",
            "rappelez l’objectif et l’entente de travail, puis faites une météo rapide.",
          ),
        ],
        [
          t("Gather data", "Recueillir les faits"),
          20,
          t(
            "ask everyone to add highs and lows from the sprint, one per note.",
            "demandez à chacun d’ajouter les hauts et les bas du sprint, un par note.",
          ),
        ],
        [
          t("Generate insights", "Dégager des constats"),
          15,
          t(
            "group the notes into themes and ask why the biggest theme happened.",
            "regroupez les notes en thèmes et demandez pourquoi le thème principal est survenu.",
          ),
        ],
        [
          t("Decide what to do", "Décider quoi faire"),
          15,
          t(
            "agree on one or two experiments with an owner. Keep them small.",
            "convenez d’une ou deux expériences avec un responsable. Gardez-les petites.",
          ),
        ],
        [
          t("Close the retrospective", "Clore la rétrospective"),
          5,
          t(
            "ask for appreciations and a return on time invested vote from 1 to 5.",
            "invitez les remerciements et un vote sur la valeur du temps investi de 1 à 5.",
          ),
        ],
      ];
      k.heading(
        0,
        0,
        2460,
        t("Retrospective playbook", "Guide de rétrospective"),
      );
      k.text(
        0,
        60,
        2460,
        t(
          "65 minutes. Based on the five phases of agile retrospectives. Present each frame in order.",
          "65 minutes. Inspiré des cinq phases des rétrospectives agiles. Présentez chaque cadre dans l’ordre.",
        ),
      );
      overview(
        k,
        120,
        2460,
        list.map(([title, minutes]) => [title, minutes]),
      );
      const a = steps(k, 260, 5, 460, 600, list);
      [
        ["emotion-high", t("Sunny", "Ensoleillé"), green],
        ["emotion-neutral", t("Cloudy", "Nuageux"), yellow],
        ["emotion-low", t("Stormy", "Orageux"), orange],
      ].forEach(([key, label, color], n) => {
        k.shape(key, a[0].x + 20 + n * 140, a[0].y, 100, 100, "", { color });
        k.shape(
          "terminator",
          a[0].x + 10 + n * 140,
          a[0].y + 120,
          120,
          40,
          label,
          { color: grey },
        );
      });
      k.note(
        a[0].x,
        a[0].y + 180,
        t(
          "Working agreement: everyone did the best job they could.",
          "Entente : chacun a fait de son mieux avec ce qu’il savait.",
        ),
        {
          w: 420,
          h: 100,
          color: blue,
        },
      );
      k.shape("terminator", a[1].x, a[1].y, 200, 40, t("Highs", "Hauts"), {
        color: green,
      });
      k.shape("terminator", a[1].x + 220, a[1].y, 200, 40, t("Lows", "Bas"), {
        color: orange,
      });
      notes(
        k,
        { ...a[1], y: a[1].y + 60 },
        [
          [t("Shipped save and resume", "Enregistrement livré"), green],
          [
            t(
              "Test environment down 2 days",
              "Environnement de test en panne 2 jours",
            ),
            orange,
          ],
          [t("Great pairing sessions", "Excellentes séances en binôme"), green],
          [
            t("Unclear acceptance criteria", "Critères d’acceptation flous"),
            orange,
          ],
        ],
        { h: 100 },
      );
      const theme = k.card(
        a[2].x,
        a[2].y,
        420,
        80,
        t(
          "Theme: unstable test environment",
          "Thème : environnement de test instable",
        ),
        {
          color: purple,
          bold: true,
        },
      );
      const why = k.note(
        a[2].x,
        a[2].y + 140,
        t(
          "Why? No one owns environment health",
          "Pourquoi? Personne n’est responsable de l’environnement",
        ),
        {
          w: 200,
          h: 120,
          color: yellow,
        },
      );
      k.note(
        a[2].x + 220,
        a[2].y + 140,
        t("Add another theme", "Ajoutez un autre thème"),
        {
          w: 200,
          h: 120,
          color: grey,
        },
      );
      k.connect(theme, why);
      table(
        k,
        a[3].x,
        a[3].y,
        420,
        [
          [
            t("Experiment", "Expérience"),
            t("Owner", "Responsable"),
            t("Check-in", "Suivi"),
          ],
          [
            t(
              "Rotate an environment steward",
              "Désigner un gardien de l’environnement",
            ),
            "Sam",
            t("Mid-sprint", "Mi-sprint"),
          ],
          [
            t(
              "Review criteria at refinement",
              "Revoir les critères au raffinement",
            ),
            "Priya",
            t("Next retro", "Prochaine rétro"),
          ],
          ["", "", ""],
        ],
        [200, 120, 100],
        [40, 70, 70, 50],
      );
      k.card(
        a[4].x,
        a[4].y,
        420,
        40,
        t("Return on time invested", "Valeur du temps investi"),
        {
          color: grey,
          bold: true,
        },
      );
      [1, 2, 3, 4, 5].forEach((n) =>
        k.shape(
          "ellipse",
          a[4].x + (n - 1) * 90,
          a[4].y + 60,
          60,
          60,
          String(n),
          { color: blue, fontSize: 20, textAlign: "center" },
        ),
      );
      dot(k, a[4].x + 10 + 3 * 90, a[4].y + 140);
      dot(k, a[4].x + 10 + 4 * 90, a[4].y + 140);
      k.note(
        a[4].x,
        a[4].y + 190,
        t(
          "Thanks to Léa for the accessibility fixes!",
          "Merci à Léa pour les correctifs d’accessibilité!",
        ),
        {
          w: 420,
          h: 100,
          color: purple,
        },
      );
    },
  },
  {
    id: "playbook-discovery",
    category: "workshops",
    playbook: true,
    name: [
      "Service design discovery workshop",
      "Atelier de découverte en conception de services",
    ],
    description: [
      "A two-hour playbook to map a journey, find pain points, and plan research.",
      "Un guide de deux heures pour cartographier un parcours, relever les irritants et planifier la recherche.",
    ],
    keywords: [
      "discovery service design journey pain points opportunities research plan",
      "découverte conception de services parcours irritants occasions plan de recherche",
    ],
    build(k) {
      const { t } = k,
        { green, orange, blue, purple, yellow, grey } = PALETTE;
      const list = [
        [
          t("Welcome and goals", "Accueil et objectifs"),
          15,
          t(
            "share the purpose, the service in focus, and what the group will leave with.",
            "présentez le but, le service visé et ce que le groupe obtiendra.",
          ),
        ],
        [
          t("Map the current journey", "Cartographier le parcours actuel"),
          30,
          t(
            "walk through the stages from the client’s point of view. Add actions under each stage.",
            "parcourez les étapes du point de vue du client. Ajoutez les actions sous chaque étape.",
          ),
        ],
        [
          t("Identify pain points", "Relever les irritants"),
          20,
          t(
            "mark where clients struggle, wait, or drop out. Use evidence where you have it.",
            "indiquez où les clients éprouvent des difficultés, attendent ou abandonnent. Appuyez-vous sur des données.",
          ),
        ],
        [
          t("Generate opportunities", "Générer des occasions"),
          20,
          t(
            "turn each pain point into a How might we question and add ideas.",
            "transformez chaque irritant en question « Comment pourrions-nous » et ajoutez des idées.",
          ),
        ],
        [
          t("Prioritize", "Prioriser"),
          20,
          t(
            "place opportunities on the impact and effort grid and agree on the top three.",
            "placez les occasions sur la grille impact et effort et retenez les trois principales.",
          ),
        ],
        [
          t(
            "Plan research and next steps",
            "Planifier la recherche et la suite",
          ),
          15,
          t(
            "list what we still need to learn, how, and who will do it.",
            "listez ce qu’il faut encore apprendre, comment et qui s’en chargera.",
          ),
        ],
      ];
      k.heading(
        0,
        0,
        1940,
        t(
          "Service design discovery workshop",
          "Atelier de découverte en conception de services",
        ),
      );
      k.text(
        0,
        60,
        1940,
        t(
          "Two hours with service staff, policy, and IT. Example service: renewing a benefit online.",
          "Deux heures avec le personnel du service, des politiques et des TI. Exemple : renouveler une prestation en ligne.",
        ),
      );
      overview(
        k,
        120,
        1940,
        list.map(([title, minutes]) => [title, minutes]),
      );
      const a = steps(k, 260, 3, 620, 580, list);
      k.card(
        a[0].x,
        a[0].y,
        580,
        80,
        t(
          "Service in focus: renewing a benefit online",
          "Service visé : renouveler une prestation en ligne",
        ),
        {
          color: blue,
          bold: true,
        },
      );
      [
        [
          t(
            "Leave with a shared journey map",
            "Repartir avec une carte de parcours commune",
          ),
          green,
        ],
        [
          t(
            "Agree on top pain points",
            "S’entendre sur les principaux irritants",
          ),
          green,
        ],
        [
          t(
            "A research plan with owners",
            "Un plan de recherche avec responsables",
          ),
          green,
        ],
      ].forEach(([text, color], n) =>
        k.note(a[0].x + n * 200, a[0].y + 100, text, { w: 180, h: 140, color }),
      );
      const stages = [
        [
          t("Find out", "S’informer"),
          [
            t("Gets a renewal letter", "Reçoit une lettre de renouvellement"),
            t("Searches Canada.ca", "Cherche sur Canada.ca"),
          ],
        ],
        [
          t("Apply", "Faire la demande"),
          [
            t("Signs in", "Se connecte"),
            t("Uploads documents", "Téléverse des documents"),
          ],
        ],
        [
          t("Get a decision", "Obtenir une décision"),
          [
            t("Waits for a letter", "Attend une lettre"),
            t("Calls to check status", "Appelle pour connaître l’état"),
          ],
        ],
      ];
      let previous = null;
      stages.forEach(([stage, actions], n) => {
        const x = a[1].x + n * 200;
        const head = k.shape("terminator", x, a[1].y, 180, 50, stage, {
          color: blue,
          bold: true,
        });
        if (previous) k.connect(previous, head);
        previous = head;
        actions.forEach((text, r) =>
          k.note(x, a[1].y + 70 + r * 110, text, {
            w: 180,
            h: 100,
            color: yellow,
          }),
        );
      });
      [
        t("Letter uses jargon", "La lettre est jargonneuse"),
        t("Upload fails on phones", "L’envoi échoue sur téléphone"),
        t("No status for 6 weeks", "Aucun suivi pendant 6 semaines"),
      ].forEach((text, n) =>
        k.shape("pain-point", a[2].x + n * 200, a[2].y, 180, 160, text, {
          color: orange,
        }),
      );
      k.note(
        a[2].x,
        a[2].y + 180,
        t(
          "Evidence: 30% of calls are status questions",
          "Donnée : 30 % des appels portent sur l’état",
        ),
        {
          w: 380,
          h: 100,
          color: grey,
        },
      );
      [
        [
          t(
            "How might we explain the letter in plain language?",
            "Comment pourrions-nous expliquer la lettre en langage clair?",
          ),
          green,
        ],
        [
          t(
            "How might we make uploads work on any device?",
            "Comment pourrions-nous faire fonctionner le téléversement sur tout appareil?",
          ),
          green,
        ],
        [
          t(
            "How might we keep clients informed while they wait?",
            "Comment pourrions-nous tenir les clients informés pendant l’attente?",
          ),
          green,
        ],
        [
          t("Idea: status updates by text message", "Idée : suivi par texto"),
          purple,
        ],
        [
          t(
            "Idea: plain language letter test",
            "Idée : tester une lettre en langage clair",
          ),
          purple,
        ],
        [
          t(
            "Idea: mobile upload with camera",
            "Idée : téléversement mobile avec l’appareil photo",
          ),
          purple,
        ],
      ].forEach(([text, color], n) =>
        k.note(a[3].x + (n % 3) * 200, a[3].y + Math.floor(n / 3) * 150, text, {
          w: 180,
          h: 130,
          color,
        }),
      );
      [
        [
          t(
            "High impact, low effort: status by text message",
            "Fort impact, faible effort : suivi par texto",
          ),
          green,
        ],
        [
          t(
            "High impact, high effort: mobile upload",
            "Fort impact, effort élevé : téléversement mobile",
          ),
          blue,
        ],
        [
          t(
            "Low impact, low effort: FAQ update",
            "Faible impact, faible effort : mise à jour de la FAQ",
          ),
          yellow,
        ],
        [
          t(
            "Low impact, high effort: new call system",
            "Faible impact, effort élevé : nouveau système d’appels",
          ),
          grey,
        ],
      ].forEach(([text, color], n) =>
        k.card(
          a[4].x + (n % 2) * 300,
          a[4].y + Math.floor(n / 2) * 150,
          280,
          130,
          text,
          { color },
        ),
      );
      table(
        k,
        a[5].x,
        a[5].y,
        580,
        [
          [
            t("What we need to learn", "Ce qu’il faut apprendre"),
            t("Method", "Méthode"),
            t("Who", "Qui"),
            t("When", "Quand"),
          ],
          [
            t("Why uploads fail on phones", "Pourquoi le téléversement échoue"),
            t("Usability test", "Test d’utilisabilité"),
            "Léa",
            t("Week 2", "Semaine 2"),
          ],
          [
            t(
              "What clients expect while waiting",
              "Ce que les clients attendent",
            ),
            t("Interviews", "Entrevues"),
            "Sam",
            t("Week 3", "Semaine 3"),
          ],
          [
            t("Call reasons by volume", "Motifs d’appel par volume"),
            t("Data analysis", "Analyse de données"),
            "Priya",
            t("Week 1", "Semaine 1"),
          ],
          ["", "", "", ""],
        ],
        [220, 150, 90, 120],
        [40, 60, 60, 60, 50],
      );
    },
  },
];
