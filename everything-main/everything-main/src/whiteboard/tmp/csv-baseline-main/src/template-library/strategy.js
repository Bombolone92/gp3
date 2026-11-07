import { PALETTE } from "./kit.js";
// A titled block with a prompt card and example sticky notes laid out in rows.
function block(k, x, y, w, h, title, prompt, color, examples, noteWidth = 160) {
  k.frame(x, y, w, h, title);
  k.card(x + 20, y + 60, w - 40, 80, prompt, {
    color: PALETTE.grey,
    textAlign: "left",
  });
  const perRow = Math.max(1, Math.floor((w - 20) / (noteWidth + 20)));
  examples.forEach((text, n) =>
    k.note(
      x + 20 + (n % perRow) * (noteWidth + 20),
      y + 160 + Math.floor(n / perRow) * 140,
      text,
      { w: noteWidth, h: 120, color },
    ),
  );
}
// The classic nine-block canvas: five columns over two wide bottom blocks.
// Split columns (1 and 3) hold two stacked blocks.
function nineBlockCanvas(k, blocks) {
  const col = 380,
    gap = 40,
    tall = 640,
    short = 300,
    top = 160;
  const place = {
    c0: [0, top, col, tall],
    c1a: [col + gap, top, col, short],
    c1b: [col + gap, top + short + gap, col, short],
    c2: [2 * (col + gap), top, col, tall],
    c3a: [3 * (col + gap), top, col, short],
    c3b: [3 * (col + gap), top + short + gap, col, short],
    c4: [4 * (col + gap), top, col, tall],
    b0: [0, top + tall + gap, 1010, short],
    b1: [1050, top + tall + gap, 1010, short],
  };
  for (const [slot, title, prompt, color, examples] of blocks)
    block(k, ...place[slot], title, prompt, color, examples);
}
export default [
  {
    id: "strategy",
    category: "strategy",
    name: ["Strategy canvas", "Canevas stratégique"],
    description: [
      "Define the vision, choices, measures, and risks on one page.",
      "Définir la vision, les choix, les mesures et les risques sur une page.",
    ],
    keywords: [
      "vision goals objectives plan direction",
      "vision buts objectifs plan orientation",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1480, t("Strategy canvas", "Canevas stratégique"));
      k.text(
        0,
        60,
        1480,
        t(
          "Work left to right: agree on the vision, choose where to focus, decide how you will measure success, then name the risks and assumptions to test.",
          "Travaillez de gauche à droite : entendez-vous sur la vision, choisissez où concentrer vos efforts, déterminez comment mesurer la réussite, puis nommez les risques et les hypothèses à vérifier.",
        ),
      );
      const columns = [
        [
          t("1 · Vision", "1 · Vision"),
          t(
            "Where do we want to be in three years, and for whom?",
            "Où voulons-nous être dans trois ans, et pour qui?",
          ),
          PALETTE.blue,
          [
            t(
              "Every client can complete their application online in one visit",
              "Chaque client peut remplir sa demande en ligne en une seule visite",
            ),
            t(
              "Services designed with and for people in Canada",
              "Des services conçus avec et pour la population canadienne",
            ),
          ],
        ],
        [
          t("2 · Strategic choices", "2 · Choix stratégiques"),
          t(
            "What will we focus on, and what will we stop doing?",
            "Sur quoi nous concentrerons-nous et que cesserons-nous de faire?",
          ),
          PALETTE.green,
          [
            t(
              "Digital first, with assisted service for those who need it",
              "Numérique d’abord, avec un service assisté au besoin",
            ),
            t(
              "Retire paper-only forms",
              "Abandonner les formulaires papier seulement",
            ),
            t(
              "Reuse shared platforms before building",
              "Réutiliser les plateformes communes avant de bâtir",
            ),
          ],
        ],
        [
          t("3 · Success measures", "3 · Mesures de réussite"),
          t(
            "How will we know the strategy is working?",
            "Comment saurons-nous que la stratégie fonctionne?",
          ),
          PALETTE.yellow,
          [
            t(
              "80% of applications submitted online",
              "80 % des demandes soumises en ligne",
            ),
            t(
              "Processing time under 10 business days",
              "Délai de traitement inférieur à 10 jours ouvrables",
            ),
            t(
              "Client satisfaction above 85%",
              "Satisfaction des clients supérieure à 85 %",
            ),
          ],
        ],
        [
          t("4 · Risks and assumptions", "4 · Risques et hypothèses"),
          t(
            "What must be true, and what could get in the way?",
            "Qu’est-ce qui doit être vrai et qu’est-ce qui pourrait nuire?",
          ),
          PALETTE.orange,
          [
            t(
              "Assumption: clients have reliable internet access",
              "Hypothèse : les clients ont un accès Internet fiable",
            ),
            t(
              "Risk: legacy systems delay integration",
              "Risque : les anciens systèmes retardent l’intégration",
            ),
          ],
        ],
      ];
      columns.forEach(([title, prompt, color, examples], n) =>
        block(k, n * 380, 140, 340, 580, title, prompt, color, examples, 300),
      );
      k.frame(
        0,
        760,
        1480,
        300,
        t("5 · Priorities for this year", "5 · Priorités pour cette année"),
      );
      k.table(
        20,
        820,
        1440,
        [
          [
            t("Priority", "Priorité"),
            t("Links to choice", "Lien avec le choix"),
            t("Measure", "Mesure"),
            t("Owner", "Responsable"),
            t("Target date", "Date cible"),
          ],
          [
            t(
              "Launch the online application pilot",
              "Lancer le projet pilote de demande en ligne",
            ),
            t("Digital first", "Numérique d’abord"),
            t("Online uptake", "Adoption en ligne"),
            t("Product owner", "Responsable du produit"),
            t("Q2", "T2"),
          ],
          [
            t(
              "Map the assisted service journey",
              "Cartographier le parcours du service assisté",
            ),
            t("Assisted service", "Service assisté"),
            t("Satisfaction", "Satisfaction"),
            t("Service designer", "Concepteur de services"),
            t("Q3", "T3"),
          ],
          ["", "", "", "", ""],
          ["", "", "", "", ""],
        ],
        { columnWidths: [480, 260, 240, 260, 200] },
      );
    },
  },
  {
    id: "lean-canvas",
    category: "strategy",
    name: ["Lean canvas", "Canevas Lean"],
    description: [
      "Test a product idea with nine focused building blocks.",
      "Mettre à l’épreuve une idée de produit en neuf blocs ciblés.",
    ],
    keywords: [
      "startup product idea business model problem solution",
      "démarrage produit idée modèle d’affaires problème solution",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 2060, t("Lean canvas", "Canevas Lean"));
      k.text(
        0,
        60,
        2060,
        t(
          "Example: online appointment booking for in-person service centres. Fill the blocks in numbered order, keep one idea per sticky note, and mark the riskiest assumptions to test first.",
          "Exemple : prise de rendez-vous en ligne pour les centres de service en personne. Remplissez les blocs dans l’ordre numéroté, une idée par note, et indiquez les hypothèses les plus risquées à vérifier en premier.",
        ),
      );
      const { blue, green, yellow, orange, purple } = PALETTE;
      nineBlockCanvas(k, [
        [
          "c0",
          t("1 · Problem", "1 · Problème"),
          t(
            "Top three problems. How are they solved today?",
            "Les trois principaux problèmes. Comment sont-ils réglés aujourd’hui?",
          ),
          orange,
          [
            t(
              "Long waits at service counters",
              "De longues attentes aux comptoirs",
            ),
            t(
              "No way to know which documents to bring",
              "Impossible de savoir quels documents apporter",
            ),
            t(
              "Existing: phone line with long hold times",
              "Actuel : ligne téléphonique avec longues attentes",
            ),
          ],
        ],
        [
          "c4",
          t("2 · Customer segments", "2 · Segments de clientèle"),
          t(
            "Who has the problem? Who are the early adopters?",
            "Qui a le problème? Qui sont les premiers utilisateurs?",
          ),
          blue,
          [
            t(
              "Working parents renewing documents",
              "Parents qui travaillent et renouvellent des documents",
            ),
            t(
              "Early adopters: urban clients who book online",
              "Premiers utilisateurs : clients urbains qui réservent en ligne",
            ),
          ],
        ],
        [
          "c2",
          t("3 · Unique value proposition", "3 · Proposition de valeur unique"),
          t(
            "A single, clear message that says why you are different.",
            "Un message unique et clair qui explique ce qui vous distingue.",
          ),
          purple,
          [
            t(
              "Book in two minutes, arrive ready, leave in twenty",
              "Réservez en deux minutes, arrivez prêt, repartez en vingt",
            ),
            t(
              "High-level concept: an agenda for public services",
              "Concept : un agenda pour les services publics",
            ),
          ],
        ],
        [
          "c1a",
          t("4 · Solution", "4 · Solution"),
          t(
            "Simplest features that solve each problem.",
            "Les fonctions les plus simples qui règlent chaque problème.",
          ),
          green,
          [
            t(
              "Online booking with reminders",
              "Réservation en ligne avec rappels",
            ),
            t(
              "Personal document checklist",
              "Liste de documents personnalisée",
            ),
          ],
        ],
        [
          "c3b",
          t("5 · Channels", "5 · Canaux"),
          t(
            "How will people find and use it?",
            "Comment les gens le trouveront-ils et l’utiliseront-ils?",
          ),
          blue,
          [
            t("Canada.ca service pages", "Pages de service sur Canada.ca"),
            t(
              "Links in renewal reminder letters",
              "Liens dans les lettres de rappel",
            ),
          ],
        ],
        [
          "b1",
          t(
            "6 · Revenue streams and value",
            "6 · Sources de revenus et valeur",
          ),
          t(
            "How is it funded? What value does it return?",
            "Comment est-il financé? Quelle valeur rapporte-t-il?",
          ),
          green,
          [
            t(
              "Program funding for digital services",
              "Financement du programme pour les services numériques",
            ),
            t(
              "Fewer repeat visits save staff time",
              "Moins de visites répétées, du temps gagné",
            ),
            t("Reduced call volumes", "Moins d’appels"),
          ],
        ],
        [
          "b0",
          t("7 · Cost structure", "7 · Structure de coûts"),
          t(
            "Main costs to build and run the service.",
            "Principaux coûts pour bâtir et exploiter le service.",
          ),
          orange,
          [
            t("Product team of six", "Équipe de produit de six personnes"),
            t("Hosting and notifications", "Hébergement et notifications"),
            t(
              "Accessibility and usability testing",
              "Tests d’accessibilité et d’utilisabilité",
            ),
          ],
        ],
        [
          "c1b",
          t("8 · Key metrics", "8 · Indicateurs clés"),
          t(
            "The few numbers that show progress.",
            "Les quelques chiffres qui montrent les progrès.",
          ),
          yellow,
          [
            t("Share of visits booked", "Part des visites réservées"),
            t("Average time in centre", "Temps moyen en centre"),
          ],
        ],
        [
          "c3a",
          t("9 · Unfair advantage", "9 · Avantage déloyal"),
          t(
            "What cannot be easily copied?",
            "Qu’est-ce qui ne peut pas être facilement copié?",
          ),
          purple,
          [
            t("Trusted government channel", "Canal public de confiance"),
            t("Real-time counter data", "Données des comptoirs en temps réel"),
          ],
        ],
      ]);
    },
  },
  {
    id: "business-model-canvas",
    category: "strategy",
    name: ["Business model canvas", "Canevas du modèle d’affaires"],
    description: [
      "Describe how a service creates, delivers, and sustains value.",
      "Décrire comment un service crée, offre et maintient de la valeur.",
    ],
    keywords: [
      "bmc value proposition partners channels funding",
      "proposition de valeur partenaires canaux financement",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        2060,
        t("Business model canvas", "Canevas du modèle d’affaires"),
      );
      k.text(
        0,
        60,
        2060,
        t(
          "Example: a digital benefits service. Start with customer segments and value propositions on the right, then the delivery side on the left. For public services, read revenue as funding and public value.",
          "Exemple : un service numérique de prestations. Commencez par les segments de clientèle et les propositions de valeur, puis la prestation à gauche. Pour les services publics, les revenus correspondent au financement et à la valeur publique.",
        ),
      );
      const { blue, green, yellow, orange, purple } = PALETTE;
      nineBlockCanvas(k, [
        [
          "c4",
          t("1 · Customer segments", "1 · Segments de clientèle"),
          t(
            "For whom are we creating value?",
            "Pour qui créons-nous de la valeur?",
          ),
          blue,
          [
            t(
              "Seniors applying for a pension",
              "Personnes âgées qui demandent une pension",
            ),
            t(
              "Caregivers acting on their behalf",
              "Proches aidants qui agissent en leur nom",
            ),
            t("Community organizations", "Organismes du milieu"),
          ],
        ],
        [
          "c2",
          t("2 · Value propositions", "2 · Propositions de valeur"),
          t(
            "What need do we meet? What problem do we solve?",
            "À quel besoin répondons-nous? Quel problème réglons-nous?",
          ),
          purple,
          [
            t(
              "Apply once, with information already on file",
              "Faire une seule demande avec les renseignements déjà au dossier",
            ),
            t(
              "Know the status at any time",
              "Connaître l’état de la demande en tout temps",
            ),
          ],
        ],
        [
          "c3b",
          t("3 · Channels", "3 · Canaux"),
          t(
            "How do we reach and serve people?",
            "Comment joignons-nous et servons-nous les gens?",
          ),
          blue,
          [
            t("Online account", "Compte en ligne"),
            t(
              "Phone and in-person centres",
              "Téléphone et centres en personne",
            ),
          ],
        ],
        [
          "c3a",
          t("4 · Customer relationships", "4 · Relations avec la clientèle"),
          t(
            "What relationship does each segment expect?",
            "Quelle relation chaque segment attend-il?",
          ),
          yellow,
          [
            t(
              "Self-service with proactive notices",
              "Libre-service avec avis proactifs",
            ),
            t("Assisted help when needed", "Aide assistée au besoin"),
          ],
        ],
        [
          "b1",
          t(
            "5 · Funding and public value",
            "5 · Financement et valeur publique",
          ),
          t(
            "How is it funded, and what value is returned?",
            "Comment est-il financé et quelle valeur rapporte-t-il?",
          ),
          green,
          [
            t("Program appropriation", "Crédits du programme"),
            t("Lower cost per application", "Coût par demande réduit"),
            t(
              "Benefits reach eligible people sooner",
              "Les prestations atteignent plus vite les personnes admissibles",
            ),
          ],
        ],
        [
          "c1b",
          t("6 · Key resources", "6 · Ressources clés"),
          t(
            "What assets does the service depend on?",
            "De quels actifs le service dépend-il?",
          ),
          yellow,
          [
            t("Client data and identity", "Données et identité des clients"),
            t("Multidisciplinary team", "Équipe aux compétences variées"),
          ],
        ],
        [
          "c1a",
          t("7 · Key activities", "7 · Activités clés"),
          t(
            "What must we do well to deliver value?",
            "Que devons-nous bien faire pour offrir de la valeur?",
          ),
          green,
          [
            t("Eligibility assessment", "Évaluation de l’admissibilité"),
            t(
              "Continuous user research",
              "Recherche continue auprès des utilisateurs",
            ),
          ],
        ],
        [
          "c0",
          t("8 · Key partners", "8 · Partenaires clés"),
          t(
            "Who helps us deliver? What do they provide?",
            "Qui nous aide à offrir le service? Qu’apportent-ils?",
          ),
          orange,
          [
            t(
              "Revenue agency for income data",
              "Agence du revenu pour les données sur le revenu",
            ),
            t("Provinces and territories", "Provinces et territoires"),
            t(
              "Shared cloud platform team",
              "Équipe de la plateforme infonuagique commune",
            ),
          ],
        ],
        [
          "b0",
          t("9 · Cost structure", "9 · Structure de coûts"),
          t(
            "What are the most important costs?",
            "Quels sont les coûts les plus importants?",
          ),
          orange,
          [
            t("Staff and contact centres", "Personnel et centres d’appels"),
            t("Platform licences and hosting", "Licences et hébergement"),
            t(
              "Security and privacy assessments",
              "Évaluations de sécurité et de confidentialité",
            ),
          ],
        ],
      ]);
    },
  },
  {
    id: "analysis",
    category: "strategy",
    name: ["SWOT analysis", "Analyse FFOM"],
    description: [
      "Assess strengths, weaknesses, opportunities, and threats, then plan.",
      "Évaluer les forces, les faiblesses, les occasions et les menaces, puis planifier.",
    ],
    keywords: ["swot tows assessment", "ffom swot évaluation"],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1760, t("SWOT analysis", "Analyse FFOM"));
      k.text(
        0,
        60,
        1760,
        t(
          "Internal factors on top, external factors below. Then combine them in the TOWS table to turn the analysis into strategies.",
          "Facteurs internes en haut, facteurs externes en bas. Combinez-les ensuite dans le tableau TOWS pour en tirer des stratégies.",
        ),
      );
      const quadrants = [
        [
          t("Strengths (internal)", "Forces (internes)"),
          t(
            "What do we do well? What do people value?",
            "Que faisons-nous bien? Qu’est-ce que les gens apprécient?",
          ),
          PALETTE.green,
          [
            t(
              "Experienced, trusted staff",
              "Personnel expérimenté et de confiance",
            ),
            t(
              "Strong accessibility practice",
              "Solide pratique d’accessibilité",
            ),
            t("Reliable client data", "Données clients fiables"),
          ],
        ],
        [
          t("Weaknesses (internal)", "Faiblesses (internes)"),
          t(
            "Where do we struggle? What slows us down?",
            "Où avons-nous des difficultés? Qu’est-ce qui nous ralentit?",
          ),
          PALETTE.orange,
          [
            t(
              "Aging case management system",
              "Système de gestion des cas vieillissant",
            ),
            t(
              "Few digital skills in-house",
              "Peu de compétences numériques à l’interne",
            ),
            t("Long approval cycles", "Longs cycles d’approbation"),
          ],
        ],
        [
          t("Opportunities (external)", "Occasions (externes)"),
          t(
            "What trends or changes can we use?",
            "Quelles tendances ou quels changements pouvons-nous exploiter?",
          ),
          PALETTE.blue,
          [
            t(
              "Shared digital identity service",
              "Service commun d’identité numérique",
            ),
            t(
              "Clients expect mobile service",
              "Les clients s’attendent à un service mobile",
            ),
            t("Partnerships with provinces", "Partenariats avec les provinces"),
          ],
        ],
        [
          t("Threats (external)", "Menaces (externes)"),
          t(
            "What could harm the service?",
            "Qu’est-ce qui pourrait nuire au service?",
          ),
          PALETTE.purple,
          [
            t("Rising security threats", "Menaces croissantes à la sécurité"),
            t("Budget pressures", "Pressions budgétaires"),
            t("Changing regulations", "Nouvelles règles"),
          ],
        ],
      ];
      quadrants.forEach(([title, prompt, color, examples], n) =>
        block(
          k,
          (n % 2) * 600,
          140 + Math.floor(n / 2) * 440,
          560,
          400,
          title,
          prompt,
          color,
          examples,
        ),
      );
      k.frame(1200, 140, 560, 840, t("TOWS strategies", "Stratégies TOWS"));
      k.table(
        1220,
        200,
        520,
        [
          ["", t("Strengths", "Forces"), t("Weaknesses", "Faiblesses")],
          [
            t("Opportunities", "Occasions"),
            t(
              "SO: use trusted data with the shared identity service",
              "Forces et occasions : utiliser des données fiables avec le service d’identité commun",
            ),
            t(
              "WO: partner with provinces to modernize case management",
              "Faiblesses et occasions : s’associer aux provinces pour moderniser la gestion des cas",
            ),
          ],
          [
            t("Threats", "Menaces"),
            t(
              "ST: apply accessibility and security by design",
              "Forces et menaces : intégrer l’accessibilité et la sécurité dès la conception",
            ),
            t(
              "WT: phase work into small, funded releases",
              "Faiblesses et menaces : découper le travail en petites versions financées",
            ),
          ],
        ],
        { h: 280, columnWidths: [120, 200, 200], rowHeights: [40, 120, 120] },
      );
      k.card(
        1220,
        520,
        520,
        80,
        t(
          "Next steps: pick one strategy per quadrant and name an owner.",
          "Prochaines étapes : choisissez une stratégie par quadrant et nommez un responsable.",
        ),
        { color: PALETTE.grey, textAlign: "left" },
      );
      k.note(
        1220,
        620,
        t(
          "Pilot shared sign-in by Q3",
          "Projet pilote de connexion commune d’ici le T3",
        ),
        {
          w: 160,
          h: 120,
          color: PALETTE.yellow,
        },
      );
      k.note(
        1400,
        620,
        t("Owner: digital lead", "Responsable : direction numérique"),
        {
          w: 160,
          h: 120,
          color: PALETTE.yellow,
        },
      );
    },
  },
  {
    id: "pestle",
    category: "strategy",
    name: ["PESTLE analysis", "Analyse PESTEL"],
    description: [
      "Scan political, economic, social, technological, legal, and environmental factors.",
      "Examiner les facteurs politiques, économiques, sociaux, technologiques, juridiques et environnementaux.",
    ],
    keywords: [
      "pestel environment scan external factors trends",
      "pestel analyse environnement facteurs externes tendances",
    ],
    build(k) {
      const { t } = k;
      k.heading(0, 0, 1280, t("PESTLE analysis", "Analyse PESTEL"));
      k.text(
        0,
        60,
        1280,
        t(
          "Scan the environment around your service. Add one factor per note, then rate the most important ones in the table below.",
          "Examinez l’environnement de votre service. Ajoutez un facteur par note, puis évaluez les plus importants dans le tableau ci-dessous.",
        ),
      );
      const factors = [
        [
          t("Political", "Politique"),
          t(
            "Government priorities, mandates, elections",
            "Priorités gouvernementales, mandats, élections",
          ),
          PALETTE.blue,
          [
            t(
              "New digital service mandate",
              "Nouveau mandat de services numériques",
            ),
            t("Election cycle in 18 months", "Élections dans 18 mois"),
          ],
        ],
        [
          t("Economic", "Économique"),
          t(
            "Budgets, costs, employment, inflation",
            "Budgets, coûts, emploi, inflation",
          ),
          PALETTE.green,
          [
            t("Tighter operating budgets", "Budgets de fonctionnement serrés"),
            t(
              "Rising demand for benefits",
              "Demande croissante de prestations",
            ),
          ],
        ],
        [
          t("Social", "Social"),
          t(
            "Demographics, expectations, trust, inclusion",
            "Démographie, attentes, confiance, inclusion",
          ),
          PALETTE.yellow,
          [
            t("Aging population", "Vieillissement de la population"),
            t("Expectation of mobile service", "Attente d’un service mobile"),
          ],
        ],
        [
          t("Technological", "Technologique"),
          t(
            "Platforms, data, automation, security",
            "Plateformes, données, automatisation, sécurité",
          ),
          PALETTE.purple,
          [
            t("Cloud-first direction", "Orientation infonuagique d’abord"),
            t("AI-assisted triage", "Tri assisté par l’IA"),
          ],
        ],
        [
          t("Legal", "Juridique"),
          t(
            "Privacy, accessibility, official languages",
            "Protection des renseignements, accessibilité, langues officielles",
          ),
          PALETTE.orange,
          [
            t("Accessible Canada Act", "Loi canadienne sur l’accessibilité"),
            t(
              "Privacy impact assessment",
              "Évaluation des facteurs relatifs à la vie privée",
            ),
          ],
        ],
        [
          t("Environmental", "Environnemental"),
          t(
            "Climate, sustainability, physical sites",
            "Climat, durabilité, sites physiques",
          ),
          PALETTE.green,
          [
            t(
              "Greening government goals",
              "Objectifs d’écologisation du gouvernement",
            ),
            t(
              "Fewer trips to service centres",
              "Moins de déplacements vers les centres",
            ),
          ],
        ],
      ];
      factors.forEach(([title, prompt, color, examples], n) =>
        block(
          k,
          (n % 3) * 440,
          140 + Math.floor(n / 3) * 380,
          400,
          340,
          title,
          prompt,
          color,
          examples,
        ),
      );
      k.frame(
        0,
        900,
        1280,
        320,
        t("Impact and likelihood", "Incidence et probabilité"),
      );
      k.table(
        20,
        960,
        1240,
        [
          [
            t("Factor", "Facteur"),
            t("Category", "Catégorie"),
            t(
              "Impact (high, medium, low)",
              "Incidence (élevée, moyenne, faible)",
            ),
            t("Likelihood", "Probabilité"),
            t("Our response", "Notre réponse"),
          ],
          [
            t("Tighter operating budgets", "Budgets de fonctionnement serrés"),
            t("Economic", "Économique"),
            t("High", "Élevée"),
            t("High", "Élevée"),
            t(
              "Prioritize self-service to reduce cost",
              "Prioriser le libre-service pour réduire les coûts",
            ),
          ],
          [
            t("Accessible Canada Act", "Loi canadienne sur l’accessibilité"),
            t("Legal", "Juridique"),
            t("High", "Élevée"),
            t("Certain", "Certaine"),
            t(
              "Test with assistive technology each release",
              "Tester avec des aides techniques à chaque version",
            ),
          ],
          ["", "", "", "", ""],
          ["", "", "", "", ""],
        ],
        // The header row fits the longer French column names on two lines.
        {
          columnWidths: [300, 180, 240, 160, 360],
          rowHeights: [56, 40, 40, 40, 40],
        },
      );
    },
  },
];
