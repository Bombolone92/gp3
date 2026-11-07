import { PALETTE } from "./kit.js";
const laneHeader = (k, x, y, w, h, text, color = PALETTE.grey) =>
  k.shape("lane-header", x, y, w, h, text, { color, textAlign: "left" });
export default [
  {
    id: "journey",
    category: "service",
    name: ["Customer journey map", "Carte du parcours client"],
    description: [
      "Follow one person through each stage: actions, touchpoints, thoughts, emotions and opportunities.",
      "Suivre une personne à chaque étape : actions, points de contact, pensées, émotions et possibilités.",
    ],
    keywords: [
      "journey map customer experience stages emotions touchpoints pain points digital transformation",
      "parcours client expérience étapes émotions points de contact irritants transformation numérique",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        2280,
        t(
          "Customer journey map: filing a home insurance claim",
          "Carte du parcours client : faire une réclamation d’assurance habitation",
        ),
      );
      k.text(
        0,
        60,
        2280,
        t(
          "How to use: choose one persona and one scenario (here, Maya’s basement flooded and she files a claim online). Work stage by stage, filling each lane from research. Move the emotion markers up or down, then circle the pain points worth fixing first.",
          "Mode d’emploi : choisissez un persona et un scénario (ici, le sous-sol de Maya a été inondé et elle fait sa réclamation en ligne). Travaillez étape par étape en remplissant chaque couloir à partir de la recherche. Déplacez les marqueurs d’émotion vers le haut ou le bas, puis encerclez les irritants à régler en premier.",
        ),
      );
      const lanes = [
        t("Actions\nWhat does Maya do?", "Actions\nQue fait Maya?"),
        t(
          "Touchpoints\nWhere does it happen?",
          "Points de contact\nOù cela se passe-t-il?",
        ),
        t("Thoughts\nWhat is she thinking?", "Pensées\nÀ quoi pense-t-elle?"),
        t("Emotions\nHow does she feel?", "Émotions\nComment se sent-elle?"),
        t(
          "Pain points\nWhat gets in the way?",
          "Irritants\nQu’est-ce qui nuit?",
        ),
        t("Opportunities\nHow might we help?", "Possibilités\nComment aider?"),
      ];
      const laneY = (n) => 240 + n * 150;
      lanes.forEach((text, n) => laneHeader(k, 0, laneY(n), 180, 130, text));
      const stages = [
        {
          title: t("1. Discover", "1. Découvrir"),
          action: t(
            "Searches “water damage claim” and reads the coverage page",
            "Cherche « réclamation dégât d’eau » et lit la page sur la couverture",
          ),
          touch: [
            t("Web search", "Recherche Web"),
            t("Insurer’s website", "Site de l’assureur"),
          ],
          thought: t(
            "“Do I qualify, and how long will it take?”",
            "« Suis-je admissible et combien de temps cela prendra-t-il? »",
          ),
          emotion: ["emotion-neutral", 22, t("Unsure", "Incertaine")],
          pain: t(
            "Rules written in policy jargon",
            "Règles rédigées dans le jargon de la police",
          ),
          idea: t(
            "Plain language coverage checker",
            "Outil de vérification de la couverture en langage clair",
          ),
        },
        {
          title: t("2. Prepare", "2. Se préparer"),
          action: t(
            "Waits for the contractor’s estimate and gathers photos",
            "Attend la soumission de l’entrepreneur et rassemble des photos",
          ),
          touch: [
            t("Contractor", "Entrepreneur"),
            t("Online customer account", "Espace client en ligne"),
          ],
          thought: t(
            "“Can I file before the contractor sends the estimate?”",
            "« Puis-je faire ma réclamation avant que l’entrepreneur envoie la soumission? »",
          ),
          emotion: ["emotion-low", 36, t("Anxious", "Anxieuse")],
          pain: t(
            "Unclear what to do while waiting",
            "On ne sait pas quoi faire pendant l’attente",
          ),
          idea: t(
            "Checklist with what to do now and what can wait",
            "Liste de ce qu’il faut faire maintenant et de ce qui peut attendre",
          ),
        },
        {
          title: t("3. Apply", "3. Faire la demande"),
          action: t(
            "Completes the online claim in about 45 minutes",
            "Remplit la réclamation en ligne en 45 minutes environ",
          ),
          touch: [
            t("Online form", "Formulaire en ligne"),
            t("Confirmation", "Confirmation"),
          ],
          thought: t(
            "“Good, it saved my answers.”",
            "« Bien, mes réponses ont été enregistrées. »",
          ),
          emotion: ["emotion-high", 0, t("Relieved", "Soulagée")],
          pain: t(
            "Session warning appears with no time left",
            "L’avertissement de session arrive trop tard",
          ),
          idea: t(
            "Autosave and a clear session timer",
            "Enregistrement automatique et minuterie claire",
          ),
        },
        {
          title: t("4. Wait for a decision", "4. Attendre la décision"),
          action: t(
            "Checks status and answers the adjuster’s questions",
            "Vérifie l’état de sa réclamation et répond aux questions de l’expert en sinistres",
          ),
          touch: [
            t("Status page", "Page d’état"),
            t("Access code letter", "Lettre avec code d’accès"),
          ],
          thought: t(
            "“Nothing has changed for two weeks. Did I miss something?”",
            "« Rien n’a changé depuis deux semaines. Ai-je oublié quelque chose? »",
          ),
          emotion: ["emotion-low", 36, t("Worried", "Inquiète")],
          pain: t(
            "Status says “in progress” with no dates",
            "L’état indique « en cours », sans date",
          ),
          idea: t(
            "Show expected dates and the next step",
            "Afficher les dates prévues et la prochaine étape",
          ),
        },
        {
          title: t("5. Get support", "5. Obtenir du soutien"),
          action: t(
            "Calls the contact centre to confirm her first payment",
            "Appelle le centre de contact pour confirmer son premier paiement",
          ),
          touch: [
            t("Contact centre", "Centre de contact"),
            t("Direct deposit", "Dépôt direct"),
          ],
          thought: t(
            "“Finally, a real answer.”",
            "« Enfin, une vraie réponse. »",
          ),
          emotion: ["emotion-high", 10, t("Confident", "Confiante")],
          pain: t("Long wait time on the phone", "Longue attente au téléphone"),
          idea: t(
            "Proactive text message when payment is sent",
            "Texto proactif lorsque le paiement est envoyé",
          ),
        },
      ];
      const markers = [];
      stages.forEach((s, n) => {
        const x = 220 + n * 420;
        k.frame(x, 180, 380, 960, s.title);
        k.note(x + 20, laneY(0), s.action, {
          w: 340,
          h: 130,
          color: PALETTE.yellow,
        });
        s.touch.forEach((text, i) =>
          k.shape("touchpoint", x + 20 + i * 180, laneY(1), 160, 130, text, {
            color: PALETTE.blue,
            fontSize: 14,
          }),
        );
        k.note(x + 20, laneY(2), s.thought, {
          w: 340,
          h: 130,
          color: PALETTE.purple,
          italic: true,
        });
        // The feeling is written under the face, where it fits at a
        // readable size, and grouped with it so they move together.
        const [key, offset, word] = s.emotion;
        const marker = k.shape(key, x + 150, laneY(3) + offset, 80, 80, "", {
          color: PALETTE.white,
        });
        const label = k.text(x + 110, laneY(3) + offset + 84, 160, word, {
          fontSize: 16,
          textAlign: "center",
        });
        k.group([marker, label]);
        markers.push(marker);
        k.shape("pain-point", x + 20, laneY(4), 340, 130, s.pain, {
          color: PALETTE.red,
        });
        k.note(x + 20, laneY(5), s.idea, {
          w: 340,
          h: 130,
          color: PALETTE.green,
        });
      });
      for (let n = 1; n < markers.length; n++)
        k.connect(markers[n - 1], markers[n], {
          lineType: "curved",
          endCap: "none",
          lineWidth: 3,
          color: PALETTE.muted,
        });
    },
  },
  {
    id: "service",
    category: "service",
    name: ["Service blueprint", "Plan de service"],
    description: [
      "Map what customers see and do against the frontstage, backstage and support processes behind it.",
      "Représenter ce que voient et font les clients face aux activités visibles, internes et de soutien.",
    ],
    keywords: [
      "service blueprint frontstage backstage line of visibility support processes digital transformation",
      "plan de service activités visibles internes ligne de visibilité processus de soutien transformation numérique",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        1940,
        t(
          "Service blueprint: renewing a membership card online",
          "Plan de service : renouveler une carte de membre en ligne",
        ),
      );
      k.text(
        0,
        60,
        1940,
        t(
          "How to use: list the customer steps across the top, then work down each column. Everything above the line of visibility is seen by the customer; everything below it must still happen for the service to work.",
          "Mode d’emploi : inscrivez les étapes du client en haut, puis travaillez chaque colonne de haut en bas. Tout ce qui se trouve au-dessus de la ligne de visibilité est vu par le client; tout ce qui est en dessous doit quand même se produire pour que le service fonctionne.",
        ),
      );
      k.frame(0, 160, 1940, 1080, t("Blueprint", "Plan"));
      const lanes = [
        [300, t("Physical evidence", "Preuves matérielles"), PALETTE.grey],
        [460, t("Customer actions", "Actions du client"), PALETTE.yellow],
        [660, t("Frontstage", "Activités visibles"), PALETTE.blue],
        [860, t("Backstage", "Activités internes"), PALETTE.purple],
        [1060, t("Support processes", "Processus de soutien"), PALETTE.green],
      ];
      for (const [y, text, color] of lanes)
        laneHeader(k, 20, y, 200, 140, text, color);
      const steps = [
        {
          title: t(
            "1. Learn how to renew",
            "1. S’informer sur le renouvellement",
          ),
          evidence: t(
            "Website renewal page",
            "Page de renouvellement sur le site Web",
          ),
          action: t(
            "Checks if they can renew online",
            "Vérifie s’il peut renouveler en ligne",
          ),
          touch: t("Website", "Site Web"),
          front: t(
            "Eligibility questions with instant answer",
            "Questions d’admissibilité avec réponse immédiate",
          ),
          back: t(
            "Content team keeps rules current",
            "L’équipe de contenu tient les règles à jour",
          ),
          support: t(
            "Web content management system",
            "Système de gestion de contenu Web",
          ),
        },
        {
          title: t("2. Fill in the form", "2. Remplir le formulaire"),
          evidence: t(
            "Online form and progress bar",
            "Formulaire en ligne et barre de progression",
          ),
          action: t(
            "Signs in and enters personal details",
            "Se connecte et remplit le formulaire",
          ),
          touch: t("Online form", "Formulaire en ligne"),
          front: t(
            "Prefilled details from last card",
            "Renseignements préremplis de la dernière carte",
          ),
          back: t(
            "Identity matched to existing file",
            "Identité rapprochée du dossier existant",
          ),
          support: t(
            "Sign-in service and member records",
            "Service de connexion et dossiers des membres",
          ),
        },
        {
          title: t(
            "3. Upload photo and pay",
            "3. Téléverser la photo et payer",
          ),
          evidence: t(
            "Photo requirements and receipt",
            "Exigences de photo et reçu",
          ),
          action: t(
            "Uploads a digital photo and pays the fee",
            "Téléverse une photo numérique et paie les frais",
          ),
          touch: t("Payment page", "Page de paiement"),
          front: t(
            "Automatic photo check with clear feedback",
            "Vérification automatique de la photo avec rétroaction claire",
          ),
          back: t(
            "Photo quality checked; payment reconciled",
            "Qualité de la photo vérifiée; paiement rapproché",
          ),
          support: t(
            "Payment processor and image service",
            "Processeur de paiement et service d’images",
          ),
        },
        {
          title: t("4. Application review", "4. Examen de la demande"),
          evidence: t(
            "Status page and email updates",
            "Page d’état et mises à jour par courriel",
          ),
          action: t(
            "Checks status and answers questions",
            "Vérifie l’état et répond aux questions",
          ),
          touch: t("Email", "Courriel"),
          front: t(
            "Agent contacts client if something is missing",
            "Un agent communique avec le client s’il manque quelque chose",
          ),
          back: t(
            "Officer verifies identity and approves",
            "Un agent vérifie l’identité et approuve",
          ),
          support: t("Case management system", "Système de gestion des cas"),
        },
        {
          title: t("5. Receive the card", "5. Recevoir la carte"),
          evidence: t("Card delivered by mail", "Carte livrée par la poste"),
          action: t(
            "Receives and signs the new card",
            "Reçoit et signe la nouvelle carte",
          ),
          touch: t("Mail", "Poste"),
          front: t(
            "Tracking number sent by email",
            "Numéro de suivi envoyé par courriel",
          ),
          back: t(
            "Card printed and quality checked",
            "Carte imprimée et contrôlée",
          ),
          support: t(
            "Print centre and delivery partner",
            "Centre d’impression et partenaire de livraison",
          ),
        },
      ];
      steps.forEach((s, n) => {
        const x = 240 + n * 340;
        k.card(x, 220, 320, 60, s.title, {
          color: PALETTE.white,
          bold: true,
        });
        k.card(x, 300, 320, 140, s.evidence, { color: PALETTE.white });
        const touch = k.shape("touchpoint", x, 460, 140, 140, s.touch, {
          color: PALETTE.blue,
          fontSize: 12,
        });
        const action = k.note(x + 160, 460, s.action, {
          w: 160,
          h: 140,
          color: PALETTE.yellow,
        });
        const front = k.card(x, 660, 320, 140, s.front, {
          color: PALETTE.blue,
        });
        const back = k.card(x, 860, 320, 140, s.back, {
          color: PALETTE.purple,
        });
        const support = k.card(x, 1060, 320, 140, s.support, {
          color: PALETTE.green,
        });
        k.connect(action, touch, { endCap: "none" });
        k.connect(action, front);
        k.connect(front, back);
        k.connect(back, support);
      });
      const divider = (y, text) =>
        k.line(20, y, 1920, y, {
          lineStyle: "dashed",
          color: PALETTE.muted,
          lineWidth: 2,
          text,
          fontSize: 14,
        });
      divider(630, t("Line of interaction", "Ligne d’interaction"));
      divider(830, t("Line of visibility", "Ligne de visibilité"));
      divider(
        1030,
        t("Line of internal interaction", "Ligne d’interaction interne"),
      );
      k.frame(
        0,
        1280,
        1940,
        260,
        t("Moments that matter and metrics", "Moments clés et mesures"),
      );
      [
        [
          t(
            "Moment that matters: photo rejected. Explain why and how to fix it.",
            "Moment clé : photo refusée. Expliquer pourquoi et comment corriger.",
          ),
          PALETTE.orange,
        ],
        [
          t(
            "Metric: online completion rate (target 85%)",
            "Mesure : taux d’achèvement en ligne (cible de 85 %)",
          ),
          PALETTE.blue,
        ],
        [
          t(
            "Metric: calls per 100 applications",
            "Mesure : appels par 100 demandes",
          ),
          PALETTE.blue,
        ],
        [
          t(
            "Opportunity: reuse identity checks from other services",
            "Possibilité : réutiliser les vérifications d’identité d’autres services",
          ),
          PALETTE.green,
        ],
        [
          t(
            "Add a moment, metric or opportunity",
            "Ajoutez un moment, une mesure ou une possibilité",
          ),
          PALETTE.yellow,
        ],
      ].forEach(([text, color], n) =>
        k.note(20 + n * 380, 1340, text, { w: 340, h: 180, color }),
      );
    },
  },
  {
    id: "ecosystem-map",
    category: "service",
    name: ["Ecosystem map", "Carte de l’écosystème"],
    description: [
      "Show the people, organizations and forces around a service and how they relate.",
      "Montrer les personnes, organisations et forces autour d’un service et leurs relations.",
    ],
    keywords: [
      "ecosystem actors map organizations relationships system digital transformation",
      "écosystème acteurs carte organisations relations système transformation numérique",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        2100,
        t(
          "Ecosystem map: membership services",
          "Carte de l’écosystème : services aux membres",
        ),
      );
      k.text(
        0,
        60,
        2100,
        t(
          "How to use: put the people the service exists for at the centre. Place each actor in the ring that matches how directly they shape the experience, then draw and label the relationships between them.",
          "Mode d’emploi : placez au centre les personnes pour qui le service existe. Placez chaque acteur dans l’anneau qui correspond à son influence directe sur l’expérience, puis tracez et nommez les relations entre eux.",
        ),
      );
      k.frame(0, 160, 1600, 1600, t("Ecosystem", "Écosystème"));
      const rings = [
        [
          40,
          200,
          1520,
          PALETTE.grey,
          t("Wider environment", "Environnement élargi"),
        ],
        [
          240,
          400,
          1120,
          PALETTE.green,
          t("Supporting organizations", "Organisations de soutien"),
        ],
        [
          440,
          600,
          720,
          PALETTE.blue,
          t("Direct service providers", "Fournisseurs directs"),
        ],
        [640, 800, 320, PALETTE.yellow, ""],
      ];
      for (const [x, y, size, color] of rings)
        k.shape("ellipse", x, y, size, size, "", { color });
      rings.slice(0, 3).forEach(([, y, , , text]) =>
        k.text(620, y + 16, 360, text, {
          fontSize: 16,
          bold: true,
          textAlign: "center",
        }),
      );
      const applicant = k.shape(
        "actor",
        730,
        820,
        140,
        180,
        t("Applicant", "Demandeur"),
        {
          color: PALETTE.orange,
          fontSize: 14,
        },
      );
      const card = (x, y, text, color = PALETTE.white) =>
        k.card(x, y, 180, 80, text, {
          color,
          fontSize: 14,
          textAlign: "center",
        });
      // The program sits below the people at the centre, so the lines and
      // labels that reach it never cover them.
      const office = card(
        710,
        1210,
        t("Membership program", "Programme de membres"),
      );
      const portal = card(
        480,
        1050,
        t("Online application", "Demande en ligne"),
      );
      const phone = card(940, 1050, t("Contact centre", "Centre de contact"));
      card(710, 660, t("Service centres", "Centres de service"));
      card(710, 460, t("Identity verification", "Vérification d’identité"));
      card(260, 920, t("Photo studios", "Studios de photo"));
      card(1160, 920, t("Delivery partner", "Partenaire de livraison"));
      card(390, 1250, t("Payment provider", "Fournisseur de paiement"));
      card(710, 260, t("Privacy law", "Loi sur la vie privée"), PALETTE.grey);
      card(
        60,
        920,
        t("Accessibility standards", "Normes d’accessibilité"),
        PALETTE.grey,
      );
      card(
        1360,
        920,
        t("Media and public trust", "Médias et confiance du public"),
        PALETTE.grey,
      );
      const budget = card(
        710,
        1580,
        t("Budget and policy", "Budget et politiques"),
        PALETTE.grey,
      );
      k.shape("actor", 560, 740, 100, 130, t("Agent", "Agent"), {
        color: PALETTE.white,
        fontSize: 12,
      });
      k.shape("actor", 1070, 570, 120, 130, t("Guarantor", "Répondant"), {
        color: PALETTE.white,
        fontSize: 12,
      });
      k.connect(applicant, portal, {
        text: t("applies online", "fait sa demande"),
      });
      k.connect(applicant, phone, {
        text: t("asks for help", "demande de l’aide"),
      });
      k.connect(phone, office, {
        text: t("escalates cases", "transmet les dossiers"),
      });
      k.connect(portal, office, {
        text: t("shares data", "transmet les données"),
      });
      k.connect(budget, office, { text: t("funds", "finance") });
      k.frame(1640, 160, 460, 760, t("Legend", "Légende"));
      rings.forEach(([, , , color, text], n) => {
        k.shape("ellipse", 1660, 220 + n * 90, 60, 60, "", { color });
        k.text(
          1740,
          236 + n * 90,
          340,
          text ||
            t("People the service is for", "Personnes visées par le service"),
          {
            fontSize: 16,
          },
        );
      });
      k.line(1660, 610, 1720, 610, { endCap: "arrow" });
      k.text(
        1740,
        596,
        340,
        t("Relationship (label it)", "Relation (nommez-la)"),
        { fontSize: 16 },
      );
      k.note(
        1660,
        660,
        t(
          "Tip: note where information, money or trust flows, and where it breaks.",
          "Astuce : notez où circulent l’information, l’argent ou la confiance, et où ils se brisent.",
        ),
        { w: 420, h: 220, color: PALETTE.yellow },
      );
    },
  },
  {
    id: "stakeholder-map",
    category: "service",
    name: ["Stakeholder map", "Carte des parties prenantes"],
    description: [
      "Place stakeholders on a power and interest grid and plan how to engage each one.",
      "Placer les parties prenantes selon leur pouvoir et leur intérêt, et planifier leur mobilisation.",
    ],
    keywords: [
      "stakeholder power interest grid engagement plan",
      "parties prenantes pouvoir intérêt grille plan de mobilisation",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        2220,
        t("Stakeholder map", "Carte des parties prenantes"),
      );
      k.text(
        0,
        60,
        2220,
        t(
          "How to use: add one note per stakeholder, place it by how much power and interest they have, then plan how and how often you will engage them.",
          "Mode d’emploi : ajoutez une note par partie prenante, placez-la selon son pouvoir et son intérêt, puis planifiez comment et à quelle fréquence la mobiliser.",
        ),
      );
      k.frame(
        0,
        160,
        1280,
        1000,
        t("Power and interest grid", "Grille pouvoir et intérêt"),
      );
      const quadrants = [
        [
          120,
          220,
          t(
            "Keep satisfied\nHigh power, low interest",
            "Satisfaire\nPouvoir élevé, faible intérêt",
          ),
          PALETTE.orange,
          [
            t("Executive office", "Bureau de la direction"),
            t("Finance committee", "Comité des finances"),
          ],
        ],
        [
          700,
          220,
          t(
            "Manage closely\nHigh power, high interest",
            "Gérer de près\nPouvoir élevé, grand intérêt",
          ),
          PALETTE.green,
          [
            t("Program director", "Directrice du programme"),
            t(
              "Chief information officer",
              "Dirigeant principal de l’information",
            ),
            t("Privacy office", "Bureau de la protection de la vie privée"),
          ],
        ],
        [
          120,
          660,
          t(
            "Monitor\nLow power, low interest",
            "Surveiller\nFaible pouvoir, faible intérêt",
          ),
          PALETTE.grey,
          [t("Other divisions", "Autres divisions"), t("Media", "Médias")],
        ],
        [
          700,
          660,
          t(
            "Keep informed\nLow power, high interest",
            "Tenir informé\nFaible pouvoir, grand intérêt",
          ),
          PALETTE.blue,
          [
            t("Frontline agents", "Agents de première ligne"),
            t("Applicants", "Demandeurs"),
            t("Advocacy groups", "Groupes de défense"),
          ],
        ],
      ];
      for (const [x, y, title, color, notes] of quadrants) {
        k.card(x, y, 540, 400, title, { color, fontSize: 18 });
        notes.forEach((text, n) =>
          k.note(
            x + 20 + (n % 3) * 170,
            y + 100 + Math.floor(n / 3) * 150,
            text,
            {
              w: 160,
              h: 110,
              color: PALETTE.white,
            },
          ),
        );
      }
      k.line(80, 1060, 80, 230, {
        endCap: "arrow",
        text: t("Power", "Pouvoir"),
        lineWidth: 2,
      });
      k.line(120, 1100, 1230, 1100, {
        endCap: "arrow",
        text: t("Interest", "Intérêt"),
        lineWidth: 2,
      });
      k.frame(
        1320,
        160,
        900,
        1000,
        t("Engagement plan", "Plan de mobilisation"),
      );
      k.table(
        1340,
        220,
        860,
        [
          [
            t("Stakeholder", "Partie prenante"),
            t("Interest", "Intérêt"),
            t("Power", "Pouvoir"),
            t("How we engage", "Mode de mobilisation"),
            t("Owner", "Responsable"),
            t("How often", "Fréquence"),
          ],
          [
            t("Program director", "Directrice du programme"),
            t("High", "Élevé"),
            t("High", "Élevé"),
            t(
              "Sprint reviews and decision log",
              "Revues de sprint et registre des décisions",
            ),
            "Priya",
            t("Every 2 weeks", "Aux 2 semaines"),
          ],
          [
            t("Privacy office", "Bureau de la protection de la vie privée"),
            t("High", "Élevé"),
            t("High", "Élevé"),
            t(
              "Early privacy impact assessment",
              "Évaluation des facteurs relatifs à la vie privée dès le début",
            ),
            "Sam",
            t("Monthly", "Mensuelle"),
          ],
          [
            t("Finance committee", "Comité des finances"),
            t("Low", "Faible"),
            t("High", "Élevé"),
            t("Briefing note at milestones", "Note d’information aux jalons"),
            "Léa",
            t("Quarterly", "Trimestrielle"),
          ],
          [
            t("Frontline agents", "Agents de première ligne"),
            t("High", "Élevé"),
            t("Low", "Faible"),
            t(
              "Co-design sessions and newsletter",
              "Séances de cocréation et bulletin",
            ),
            "Alex",
            t("Monthly", "Mensuelle"),
          ],
          [
            t("Applicants", "Demandeurs"),
            t("High", "Élevé"),
            t("Low", "Faible"),
            t(
              "Usability testing and feedback form",
              "Tests d’utilisabilité et formulaire de rétroaction",
            ),
            "Jordan",
            t("Each release", "À chaque version"),
          ],
          ["", "", "", "", "", ""],
        ],
        {
          columnWidths: [180, 100, 100, 260, 120, 100],
          rowHeights: [40, 90, 90, 90, 90, 90, 90],
          h: 580,
        },
      );
      k.note(
        1340,
        840,
        t(
          "Tip: revisit the map at each phase. Stakeholders move as the project changes.",
          "Astuce : revoyez la carte à chaque phase. Les parties prenantes changent de place à mesure que le projet évolue.",
        ),
        { w: 420, h: 180, color: PALETTE.yellow },
      );
    },
  },
];
