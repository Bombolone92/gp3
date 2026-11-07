import { PALETTE } from "./kit.js";
import { autoLayoutMindMaps } from "../mind-map.js";
// A row of legend symbols, each with a centred caption underneath.
function legendRow(k, x, y, cell, entries) {
  entries.forEach(([key, text, color, w = 80, h = 60], n) => {
    const cx = x + n * cell + cell / 2;
    k.shape(key, Math.round((cx - w / 2) / 10) * 10, y, w, h, "", { color });
    k.text(cx - cell / 2 + 10, y + h + 10, cell - 20, text, {
      fontSize: 14,
      textAlign: "center",
    });
  });
}
export default [
  {
    id: "mindmap",
    category: "diagramming",
    name: ["Mind map", "Carte mentale"],
    description: [
      "Connect a central idea to themes and details in a live, auto-arranged hierarchy.",
      "Relier une idée centrale à des thèmes et des détails dans une hiérarchie disposée automatiquement.",
    ],
    keywords: [
      "mind map brainstorm ideas branches hierarchy",
      "carte mentale remue-méninges idées branches hiérarchie",
    ],
    build(k) {
      const { t } = k;
      const heading = k.heading(0, 0, 1200, t("Mind map", "Carte mentale"));
      const intro = k.text(
        0,
        60,
        1200,
        t(
          "How to use: select a node and use its plus buttons to add branches. Drag a branch onto another node to reassign it; the map rearranges itself automatically.",
          "Mode d’emploi : sélectionnez un nœud et utilisez ses boutons plus pour ajouter des branches. Glissez une branche sur un autre nœud pour la réassigner; la carte se réorganise automatiquement.",
        ),
      );
      const node = (text, parent, direction, order, color, level) =>
        k.shape("rectangle", 0, 0, level ? 180 : 200, level ? 60 : 70, text, {
          color,
          fontSize: level ? 16 : 20,
          textAlign: "center",
          order,
          mindMap: {
            parent: parent.id,
            direction,
            auto: true,
            line: "curved",
          },
        });
      const root = k.shape(
        "rectangle",
        700,
        600,
        260,
        100,
        t("Launch a digital service", "Lancer un service numérique"),
        {
          color: PALETTE.green,
          fontSize: 24,
          textAlign: "center",
          mindMap: {
            parent: null,
            direction: "right",
            auto: true,
            line: "curved",
          },
        },
      );
      const branches = [
        [
          "right",
          PALETTE.blue,
          t("Users and needs", "Usagers et besoins"),
          [
            t("User research", "Recherche utilisateur"),
            t("Accessibility (WCAG 2.1 AA)", "Accessibilité (WCAG 2.1 AA)"),
            t("Official languages", "Langues officielles"),
          ],
        ],
        [
          "right",
          PALETTE.yellow,
          t("Delivery", "Livraison"),
          [
            t("Agile team", "Équipe agile"),
            t("Roadmap", "Feuille de route"),
            t("Risks", "Risques"),
          ],
        ],
        [
          "right",
          PALETTE.purple,
          t("Technology", "Technologie"),
          [
            t("Cloud hosting", "Hébergement infonuagique"),
            t("Security assessment", "Évaluation de la sécurité"),
          ],
        ],
        [
          "left",
          PALETTE.orange,
          t("Policy and privacy", "Politiques et vie privée"),
          [
            t(
              "Privacy impact assessment",
              "Évaluation des facteurs relatifs à la vie privée",
            ),
            t("Data sharing agreements", "Ententes d’échange de données"),
          ],
        ],
        [
          "left",
          PALETTE.white,
          t("Channels", "Canaux"),
          [
            t("Online", "En ligne"),
            t("Phone", "Téléphone"),
            t("In person", "En personne"),
          ],
        ],
        [
          "left",
          PALETTE.grey,
          t("Measures", "Mesures"),
          [
            t("Completion rate", "Taux d’achèvement"),
            t("Satisfaction", "Satisfaction"),
          ],
        ],
      ];
      branches.forEach(([direction, color, text, children], n) => {
        const branch = node(text, root, direction, n + 1, color, 0);
        children.forEach((child, c) =>
          node(child, branch, direction, c + 1, color, 1),
        );
      });
      autoLayoutMindMaps(k.items);
      // Move the laid-out map below the heading, keeping a 10px grid.
      const nodes = k.items.filter((i) => i.mindMap);
      const left = Math.min(...nodes.map((i) => i.x)),
        top = Math.min(...nodes.map((i) => i.y));
      for (const i of nodes) {
        i.x = Math.round((i.x - left) / 10) * 10;
        i.y = Math.round((i.y - top + 160) / 10) * 10;
      }
      const width = Math.max(...nodes.map((i) => i.x + i.w));
      heading.w = width;
      intro.w = width;
    },
  },
  {
    id: "architecture",
    category: "diagramming",
    name: ["System architecture", "Architecture de système"],
    description: [
      "Diagram users, network zones, services and data stores with architecture shapes.",
      "Schématiser les usagers, les zones réseau, les services et les données avec des formes d’architecture.",
    ],
    keywords: [
      "architecture cloud server database api network diagram infrastructure",
      "architecture nuage serveur base de données api réseau diagramme infrastructure",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        1940,
        t(
          "System architecture: online benefits service",
          "Architecture de système : service de prestations en ligne",
        ),
      );
      k.text(
        0,
        60,
        1940,
        t(
          "How to use: group components by network zone, left to right from the user to the data. Label every connection with its protocol or purpose, and replace the examples with your own components from the Architecture shapes.",
          "Mode d’emploi : regroupez les composants par zone réseau, de gauche à droite, de l’usager jusqu’aux données. Nommez chaque connexion selon son protocole ou son rôle, et remplacez les exemples par vos composants tirés des formes d’architecture.",
        ),
      );
      k.frame(0, 160, 440, 760, t("Public internet", "Internet public"));
      k.frame(
        480,
        160,
        320,
        760,
        t("Perimeter (DMZ)", "Périmètre (zone démilitarisée)"),
      );
      k.frame(
        840,
        160,
        640,
        760,
        t(
          "Application tier (cloud, Protected B)",
          "Niveau application (nuage, Protégé B)",
        ),
      );
      k.frame(1520, 160, 420, 760, t("Data tier", "Niveau données"));
      const node = (key, x, y, w, h, text, color = PALETTE.white) =>
        k.shape(key, x, y, w, h, text, { color, fontSize: 14 });
      const user = node(
        "actor",
        30,
        460,
        140,
        180,
        t("Applicant", "Demandeur"),
        PALETTE.yellow,
      );
      user.fontSize = 12;
      const browser = node(
        "browser",
        200,
        300,
        220,
        140,
        t("Web browser", "Navigateur Web"),
      );
      const mobile = node(
        "mobile",
        250,
        620,
        110,
        180,
        t("Mobile app", "Appli mobile"),
      );
      const firewall = node(
        "firewall",
        540,
        380,
        200,
        100,
        t("Web application firewall", "Pare-feu applicatif Web"),
        PALETTE.orange,
      );
      const balancer = node(
        "load-balancer",
        540,
        600,
        200,
        100,
        t("Load balancer", "Répartiteur de charge"),
        PALETTE.orange,
      );
      const notify = node(
        "cloud",
        880,
        240,
        220,
        130,
        t("Notification service", "Service de notification"),
        PALETTE.blue,
      );
      const api = node(
        "api",
        880,
        460,
        200,
        100,
        t("API gateway", "Passerelle d’API"),
        PALETTE.blue,
      );
      const benefits = node(
        "container",
        1240,
        380,
        200,
        100,
        t("Benefits service", "Service des prestations"),
        PALETTE.blue,
      );
      const documents = node(
        "container",
        1240,
        560,
        200,
        100,
        t("Documents service", "Service des documents"),
        PALETTE.blue,
      );
      const queue = node(
        "queue",
        880,
        720,
        200,
        80,
        t("Event queue", "File d’événements"),
        PALETTE.blue,
      );
      const batch = node(
        "server",
        1240,
        740,
        200,
        120,
        t("Batch server", "Serveur de traitement par lots"),
        PALETTE.blue,
      );
      const cases = node(
        "cylinder",
        1620,
        300,
        220,
        140,
        t("Case database", "Base de données des dossiers"),
        PALETTE.green,
      );
      const files = node(
        "cylinder",
        1620,
        520,
        220,
        140,
        t("Document storage", "Stockage des documents"),
        PALETTE.green,
      );
      const warehouse = node(
        "cylinder",
        1620,
        740,
        220,
        140,
        t("Analytics warehouse", "Entrepôt analytique"),
        PALETTE.green,
      );
      k.connect(user, browser);
      k.connect(user, mobile);
      k.connect(browser, firewall, { text: "HTTPS" });
      k.connect(mobile, firewall, { text: "HTTPS" });
      k.connect(firewall, balancer);
      k.connect(balancer, api);
      k.connect(api, benefits, { text: "REST" });
      k.connect(api, documents);
      k.connect(benefits, notify, { text: t("notify", "aviser") });
      k.connect(benefits, cases, { text: "SQL" });
      k.connect(documents, files);
      k.connect(documents, queue, { text: t("events", "événements") });
      k.connect(queue, batch);
      k.connect(batch, warehouse, {
        text: t("nightly ETL", "ETL de nuit"),
      });
      k.frame(0, 960, 1940, 240, t("Legend", "Légende"));
      legendRow(k, 20, 1030, 190, [
        [
          "actor",
          t("User or actor", "Usager ou acteur"),
          PALETTE.yellow,
          50,
          70,
        ],
        ["browser", t("Browser", "Navigateur"), PALETTE.white],
        [
          "mobile",
          t("Mobile device", "Appareil mobile"),
          PALETTE.white,
          40,
          70,
        ],
        ["firewall", t("Firewall", "Pare-feu"), PALETTE.orange],
        [
          "load-balancer",
          t("Load balancer", "Répartiteur de charge"),
          PALETTE.orange,
        ],
        ["cloud", t("Cloud service", "Service infonuagique"), PALETTE.blue],
        ["api", t("API", "API"), PALETTE.blue],
        ["container", t("Container", "Conteneur"), PALETTE.blue],
        ["queue", t("Queue", "File d’attente"), PALETTE.blue],
        ["cylinder", t("Database", "Base de données"), PALETTE.green],
      ]);
    },
  },
  {
    id: "data-flow",
    category: "diagramming",
    name: ["Data flow diagram", "Diagramme de flux de données"],
    description: [
      "Show how information moves between people, processes and data stores, and where it crosses a trust boundary.",
      "Montrer comment l’information circule entre personnes, processus et dépôts de données, et où elle franchit une frontière de confiance.",
    ],
    keywords: [
      "data flow diagram dfd process data store external entity privacy",
      "diagramme flux de données processus dépôt entité externe vie privée",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        2260,
        t(
          "Data flow diagram: benefit payments",
          "Diagramme de flux de données : paiement des prestations",
        ),
      );
      k.text(
        0,
        60,
        2260,
        t(
          "How to use: number each process, name every flow with the data it carries, and mark where data leaves your organization. Use it to support privacy impact and security assessments.",
          "Mode d’emploi : numérotez chaque processus, nommez chaque flux selon les données transportées et indiquez où les données quittent votre organisation. Utilisez-le pour appuyer les évaluations de la vie privée et de la sécurité.",
        ),
      );
      k.frame(0, 160, 1840, 900, t("Level 1 diagram", "Diagramme de niveau 1"));
      // Entities beside a process leave room for the named flow between.
      const entity = (x, y, text, w = 200) =>
        k.shape("rectangle", x, y, w, 100, text, {
          color: PALETTE.yellow,
          textAlign: "center",
        });
      const process = (x, y, text) =>
        k.shape("ellipse", x, y, 220, 140, text, {
          color: PALETTE.blue,
          textAlign: "center",
        });
      const store = (x, y, text) =>
        k.shape("data-store", x, y, 220, 70, text, {
          color: PALETTE.green,
          textAlign: "center",
        });
      const applicant = entity(40, 460, t("Applicant", "Demandeur"), 160);
      const submit = process(
        420,
        440,
        t("1.0 Submit application", "1.0 Soumettre la demande"),
      );
      const assess = process(
        860,
        440,
        t("3.0 Assess eligibility", "3.0 Évaluer l’admissibilité"),
      );
      const verify = process(
        860,
        220,
        t("2.0 Verify income", "2.0 Vérifier le revenu"),
      );
      const pay = process(
        1200,
        720,
        t("4.0 Issue payment", "4.0 Émettre le paiement"),
      );
      const cra = entity(
        1620,
        240,
        t("Canada Revenue Agency", "Agence du revenu du Canada"),
        180,
      );
      const bank = entity(
        1620,
        740,
        t("Applicant’s bank", "Banque du demandeur"),
        180,
      );
      const applications = store(420, 780, t("D1 Applications", "D1 Demandes"));
      const payments = store(1200, 940, t("D2 Payments", "D2 Paiements"));
      k.connect(applicant, submit, {
        text: t("application details", "détails de la demande"),
      });
      k.connect(submit, applications, {
        text: t("application record", "dossier de demande"),
      });
      k.connect(submit, assess, {
        text: t("complete application", "demande complète"),
      });
      k.connect(assess, verify, {
        startCap: "arrow",
        text: t("income check", "vérification du revenu"),
      });
      k.connect(verify, cra, {
        startCap: "arrow",
        text: t("SIN and consent / income", "NAS et consentement / revenu"),
      });
      k.connect(assess, pay, {
        text: t("approved amount", "montant approuvé"),
      });
      k.connect(pay, bank, { text: t("payment file", "fichier de paiement") });
      k.connect(pay, payments, {
        text: t("payment record", "registre de paiement"),
      });
      k.connect(pay, applicant, {
        text: t("payment notice", "avis de paiement"),
      });
      k.line(1500, 200, 1500, 1040, {
        lineStyle: "dashed",
        color: PALETTE.muted,
        lineWidth: 2,
        text: t("Trust boundary", "Frontière de confiance"),
        fontSize: 14,
      });
      k.frame(1880, 160, 380, 900, t("Legend", "Légende"));
      const rows = [
        ["rectangle", t("External entity", "Entité externe"), PALETTE.yellow],
        [
          "ellipse",
          t("Process (numbered)", "Processus (numéroté)"),
          PALETTE.blue,
        ],
        ["data-store", t("Data store", "Dépôt de données"), PALETTE.green],
      ];
      rows.forEach(([key, text, color], n) => {
        k.shape(key, 1900, 220 + n * 100, 120, 60, "", { color });
        k.text(2040, 236 + n * 100, 200, text, { fontSize: 16 });
      });
      k.line(1900, 550, 2020, 550, { endCap: "arrow" });
      k.text(
        2040,
        536,
        200,
        t("Data flow (named)", "Flux de données (nommé)"),
        { fontSize: 16 },
      );
      k.line(1900, 630, 2020, 630, {
        lineStyle: "dashed",
        color: PALETTE.muted,
        lineWidth: 2,
      });
      k.text(2040, 616, 200, t("Trust boundary", "Frontière de confiance"), {
        fontSize: 16,
      });
      k.note(
        1900,
        700,
        t(
          "Tip: every flow that crosses the trust boundary needs an agreement and a security control.",
          "Astuce : chaque flux qui franchit la frontière de confiance exige une entente et une mesure de sécurité.",
        ),
        { w: 340, h: 200, color: PALETTE.yellow },
      );
    },
  },
  {
    id: "bpmn-process",
    category: "diagramming",
    name: ["BPMN process", "Processus BPMN"],
    description: [
      "Model a business process across swimlanes with BPMN events, tasks and gateways.",
      "Modéliser un processus d’affaires par couloirs avec les événements, tâches et passerelles BPMN.",
    ],
    keywords: [
      "bpmn business process model swimlane workflow gateway",
      "bpmn processus d’affaires modèle couloir flux de travail passerelle",
    ],
    build(k) {
      const { t } = k;
      k.heading(
        0,
        0,
        2320,
        t(
          "BPMN process: small business grant",
          "Processus BPMN : subvention aux petites entreprises",
        ),
      );
      k.text(
        0,
        60,
        2320,
        t(
          "How to use: give each role a lane, start with a start event and end every path with an end event. Use gateways for decisions (X) and parallel work (+), and label every outgoing flow of a decision.",
          "Mode d’emploi : attribuez un couloir à chaque rôle, commencez par un événement de début et terminez chaque chemin par un événement de fin. Utilisez des passerelles pour les décisions (X) et le travail en parallèle (+), et nommez chaque sortie d’une décision.",
        ),
      );
      k.frame(0, 160, 2320, 840, t("Process", "Processus"));
      const lanes = [
        [220, t("Applicant", "Demandeur"), PALETTE.yellow],
        [480, t("Program officer", "Agent de programme"), PALETTE.blue],
        [740, t("System", "Système"), PALETTE.purple],
      ];
      for (const [y, text, color] of lanes) {
        k.shape("lane-header", 20, y, 160, 240, text, {
          color,
          textAlign: "left",
        });
        k.card(200, y, 2100, 240, "", { color: PALETTE.white });
      }
      const task = (x, y, text) =>
        k.shape("bpmn-task", x, y, 160, 100, text, {
          color: PALETTE.white,
          fontSize: 14,
        });
      const gateway = (key, x, y, text = "") =>
        k.shape(key, x, y, 80, 80, text, {
          color: PALETTE.yellow,
          fontSize: 12,
        });
      const event = (key, x, y) =>
        k.shape(key, x, y, 60, 60, "", { color: PALETTE.white });
      const start = event("start-event", 240, 310);
      k.text(210, 380, 120, t("Need funding", "Besoin de financement"), {
        fontSize: 12,
        textAlign: "center",
      });
      const submit = task(
        340,
        290,
        t("Submit application", "Soumettre la demande"),
      );
      const provide = task(
        760,
        290,
        t(
          "Provide missing information",
          "Fournir les renseignements manquants",
        ),
      );
      const end = event("end-event", 2160, 310);
      // Above the end event: its flow arrives from below.
      k.text(2130, 290, 120, t("Decision received", "Décision reçue"), {
        fontSize: 12,
        textAlign: "center",
      });
      const split = gateway("gateway-parallel", 980, 820);
      const eligibility = task(
        1300,
        550,
        t("Check eligibility", "Vérifier l’admissibilité"),
      );
      const join = gateway("gateway-parallel", 1640, 820);
      const decide = task(
        1760,
        550,
        t("Approve or refuse", "Approuver ou refuser"),
      );
      const validate = task(
        560,
        810,
        t("Validate completeness", "Valider l’intégralité"),
      );
      const complete = gateway("gateway-exclusive", 800, 820);
      k.text(780, 910, 120, t("Complete?", "Complète?"), {
        fontSize: 12,
        textAlign: "center",
      });
      const identity = task(
        1300,
        810,
        t("Verify identity", "Vérifier l’identité"),
      );
      const notice = event("intermediate-event", 2000, 570);
      k.text(1970, 640, 120, t("Send decision", "Envoyer la décision"), {
        fontSize: 12,
        textAlign: "center",
      });
      const file = k.shape("data-object", 560, 290, 70, 90, "", {
        color: PALETTE.white,
      });
      k.text(530, 390, 130, t("Application file", "Dossier de demande"), {
        fontSize: 12,
        textAlign: "center",
      });
      const flow = { lineType: "elbow" };
      k.connect(start, submit, flow);
      k.connect(submit, validate, flow);
      k.connect(validate, complete, flow);
      k.connect(complete, provide, { ...flow, text: t("No", "Non") });
      k.connect(provide, validate);
      k.connect(complete, split, { ...flow, text: t("Yes", "Oui") });
      k.connect(split, eligibility, flow);
      k.connect(split, identity, flow);
      k.connect(eligibility, join, flow);
      k.connect(identity, join, flow);
      k.connect(join, decide, flow);
      k.connect(decide, notice, flow);
      k.connect(notice, end, flow);
      k.connect(submit, file, { lineStyle: "dotted", endCap: "none" });
      k.frame(0, 1040, 2320, 220, t("Legend", "Légende"));
      legendRow(k, 20, 1100, 280, [
        [
          "start-event",
          t("Start event", "Événement de début"),
          PALETTE.white,
          50,
          50,
        ],
        [
          "intermediate-event",
          t("Intermediate event", "Événement intermédiaire"),
          PALETTE.white,
          50,
          50,
        ],
        [
          "end-event",
          t("End event", "Événement de fin"),
          PALETTE.white,
          50,
          50,
        ],
        ["bpmn-task", t("Task", "Tâche"), PALETTE.white, 90, 50],
        [
          "gateway-exclusive",
          t("Exclusive gateway (one path)", "Passerelle exclusive (un chemin)"),
          PALETTE.yellow,
          60,
          60,
        ],
        [
          "gateway-parallel",
          t(
            "Parallel gateway (all paths)",
            "Passerelle parallèle (tous les chemins)",
          ),
          PALETTE.yellow,
          60,
          60,
        ],
        [
          "gateway-inclusive",
          t(
            "Inclusive gateway (some paths)",
            "Passerelle inclusive (certains chemins)",
          ),
          PALETTE.yellow,
          60,
          60,
        ],
        [
          "data-object",
          t("Data object", "Objet de données"),
          PALETTE.white,
          40,
          50,
        ],
      ]);
    },
  },
];
