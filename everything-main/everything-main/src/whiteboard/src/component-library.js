import { createKit, PALETTE } from "./template-library/kit.js";
import { searchIndex, searchWords, matchesWord } from "./libraries.js";
import { updateConnectors } from "./scene.js";
import { SHAPE_COLORS } from "./shape-specs.js";
// Reusable composite components are ordinary objects inserted as one group,
// so they can be moved together, ungrouped, restyled, and edited in place.
export const COMPONENT_GROUPS = [
  { id: "web", name: ["Web design system", "Système de design Web"] },
  { id: "wireframe", name: ["Wireframe kits", "Trousses de maquettes"] },
  {
    id: "diagram",
    name: ["Diagram building blocks", "Éléments de diagramme"],
  },
  {
    id: "facilitation",
    name: ["Facilitation kits", "Trousses d’animation"],
  },
  {
    id: "delivery",
    name: [
      "Service design and delivery kits",
      "Trousses de conception et de livraison",
    ],
  },
];
// Colors for a plain, accessible website look. Components use neutral text
// placeholders in place of logos.
const WEB = {
  text: "#333333",
  navy: "#26374a",
  link: "#284162",
  focus: "#0535d2",
  white: "#ffffff",
  light: "#f8f8f8",
  secondary: "#eaebed",
  hint: "#5c5c5c",
  green: "#278400",
  danger: "#bc3331",
  error: "#d3080c",
};
const ALERTS = {
  info: ["#269abc", "#d7faff"],
  success: ["#278400", "#d8eeca"],
  warning: ["#ee7100", "#f9f4d4"],
  danger: ["#d3080c", "#f3e9e8"],
};
// Shared building helpers. Text carries the design system's colors; on the
// bare board, `themeInk` lets the dark ones follow the theme instead.
const label = (k, x, y, w, text, extra = {}) =>
  k.text(x, y, w, text, { fontSize: 16, textColor: WEB.text, ...extra });
const strong = (k, x, y, w, text, extra = {}) =>
  label(k, x, y, w, text, { bold: true, ...extra });
const link = (k, x, y, w, text, extra = {}) =>
  label(k, x, y, w, text, { textColor: WEB.link, underline: true, ...extra });
const hint = (k, x, y, w, text, extra = {}) =>
  label(k, x, y, w, text, { fontSize: 14, textColor: WEB.hint, ...extra });
const panel = (k, x, y, w, h, color = WEB.white, extra = {}) =>
  k.card(x, y, w, h, "", { color, ...extra });
const widget = (k, key, x, y, w, h, text = "", extra = {}) =>
  k.shape(key, x, y, w, h, text, {
    fontSize: 15,
    autoFontSize: false,
    textColor: WEB.text,
    ...extra,
  });
const field = (k, x, y, w, h, text = "", extra = {}) =>
  widget(k, "wf-input", x, y, w, h, text, { textAlign: "left", ...extra });
const button = (k, x, y, w, h, text, kind = "primary", extra = {}) =>
  widget(k, "wf-button", x, y, w, h, text, {
    color:
      kind === "primary"
        ? WEB.navy
        : kind === "danger"
          ? WEB.danger
          : kind === "cta"
            ? WEB.green
            : WEB.secondary,
    textColor: ["primary", "danger", "cta"].includes(kind)
      ? WEB.white
      : WEB.navy,
    fontSize: 16,
    ...extra,
  });
function alert(kind, heading, body) {
  return (k) => {
    const [border, background] = ALERTS[kind];
    panel(k, 0, 0, 640, 110, background);
    panel(k, 0, 0, 10, 110, border);
    strong(k, 30, 18, 590, k.t(...heading), { fontSize: 18 });
    label(k, 30, 54, 590, k.t(...body));
  };
}
// Numbered progress steps; states are "done", "current", or "next".
function stepper(k, steps, { done, current, next, width = 200 }) {
  const nodes = steps.map(([name, state], n) => {
    const x = n * width + (width - 40) / 2;
    const [fill, text] =
      state === "done" ? done : state === "current" ? current : next;
    const node = widget(k, "terminator", x, 0, 40, 40, String(n + 1), {
      color: fill,
      textColor: text,
      fontSize: 16,
      bold: true,
    });
    label(k, n * width + 10, 56, width - 20, k.t(...name), {
      fontSize: 14,
      textAlign: "center",
      bold: state === "current",
    });
    return node;
  });
  for (let n = 1; n < nodes.length; n++)
    k.connect(nodes[n - 1], nodes[n], {
      endCap: "none",
      color: PALETTE.muted,
    });
}
const wire = {
  primary: PALETTE.blue,
  surface: PALETTE.white,
  muted: PALETTE.grey,
  ink: PALETTE.ink,
};
export const COMPONENTS = [
  // Web design system blocks.
  {
    id: "web-header",
    group: "web",
    name: ["Page header", "En-tête de page"],
    description: [
      "Logo placeholder, language toggle, search, menu, and breadcrumb.",
      "Espace pour le logo, lien de langue, recherche, menu et fil d’Ariane.",
    ],
    keywords: ["website header banner", "site Web en-tête bannière"],
    build(k) {
      panel(k, 0, 0, 960, 240);
      k.card(
        20,
        20,
        340,
        50,
        k.t("[Organization logo]", "[Logo de l’organisation]"),
        {
          color: WEB.light,
          fontSize: 14,
          autoFontSize: false,
          textColor: WEB.hint,
        },
      );
      link(k, 780, 20, 160, k.t("Français", "English"), {
        textAlign: "right",
      });
      field(
        k,
        500,
        80,
        320,
        44,
        k.t("Search the site", "Rechercher dans le site"),
        { textColor: WEB.hint },
      );
      button(k, 820, 80, 120, 44, k.t("Search", "Rechercher"));
      panel(k, 0, 140, 960, 50, WEB.light);
      button(k, 20, 146, 120, 38, k.t("Menu", "Menu"), "primary", {
        fontSize: 15,
      });
      link(
        k,
        20,
        200,
        920,
        k.t(
          "Home  >  Services  >  Memberships",
          "Accueil  >  Services  >  Adhésions",
        ),
        { fontSize: 15 },
      );
    },
  },
  {
    id: "web-footer",
    group: "web",
    name: ["Page footer", "Pied de page"],
    description: [
      "Navy link band with a sub-footer and a logo placeholder.",
      "Bande de liens bleu marine, pied de page secondaire et espace pour le logo.",
    ],
    keywords: ["website footer links", "site Web pied de page liens"],
    build(k) {
      panel(k, 0, 0, 960, 210, WEB.navy);
      strong(k, 30, 24, 600, k.t("About us", "À propos de nous"), {
        fontSize: 20,
        textColor: WEB.white,
      });
      const columns = [
        [
          ["Contact us", "Contactez-nous"],
          ["Locations", "Nos bureaux"],
          ["Careers", "Carrières"],
        ],
        [
          ["News", "Nouvelles"],
          ["Policies and terms", "Politiques et conditions"],
          ["Annual reports", "Rapports annuels"],
        ],
        [
          ["Leadership", "Direction"],
          ["How we work", "Notre fonctionnement"],
          ["Open data", "Données ouvertes"],
        ],
      ];
      columns.forEach((links, c) =>
        links.forEach((text, r) =>
          link(k, 30 + c * 310, 76 + r * 40, 290, k.t(...text), {
            fontSize: 15,
            textColor: WEB.white,
          }),
        ),
      );
      panel(k, 0, 210, 960, 80, WEB.light);
      link(
        k,
        30,
        236,
        680,
        k.t(
          "Social media · Mobile applications · About this site · Terms and conditions · Privacy",
          "Médias sociaux · Applications mobiles · À propos de ce site · Avis · Confidentialité",
        ),
        { fontSize: 14, underline: false },
      );
      k.card(
        740,
        225,
        190,
        50,
        k.t("[Organization logo]", "[Logo de l’organisme]"),
        {
          color: WEB.white,
          fontSize: 14,
          autoFontSize: false,
          textColor: WEB.hint,
        },
      );
    },
  },
  {
    id: "web-alert-info",
    group: "web",
    name: ["Information alert", "Alerte d’information"],
    description: [
      "Blue accent banner for helpful context.",
      "Bannière à accent bleu pour un contexte utile.",
    ],
    keywords: ["alert banner notice info", "alerte bannière avis info"],
    build: alert(
      "info",
      ["Applications open on May 1", "Les demandes ouvrent le 1er mai"],
      [
        "Prepare your documents in advance to apply faster.",
        "Préparez vos documents à l’avance pour faire une demande plus rapidement.",
      ],
    ),
  },
  {
    id: "web-alert-success",
    group: "web",
    name: ["Success alert", "Alerte de réussite"],
    description: [
      "Green accent banner confirming a completed action.",
      "Bannière à accent vert qui confirme une action terminée.",
    ],
    keywords: ["alert banner confirmation", "alerte bannière confirmation"],
    build: alert(
      "success",
      ["Your application was submitted", "Votre demande a été soumise"],
      [
        "Your reference number is A-2026-0412. Keep it for your records.",
        "Votre numéro de référence est A-2026-0412. Conservez-le pour vos dossiers.",
      ],
    ),
  },
  {
    id: "web-alert-warning",
    group: "web",
    name: ["Warning alert", "Alerte d’avertissement"],
    description: [
      "Orange accent banner for important cautions.",
      "Bannière à accent orange pour les mises en garde importantes.",
    ],
    keywords: ["alert banner caution", "alerte bannière mise en garde"],
    build: alert(
      "warning",
      ["Your session will expire soon", "Votre session expirera bientôt"],
      [
        "Save your progress to avoid losing your answers.",
        "Enregistrez votre progression pour ne pas perdre vos réponses.",
      ],
    ),
  },
  {
    id: "web-alert-danger",
    group: "web",
    name: ["Danger alert", "Alerte de danger"],
    description: [
      "Red accent banner for errors that block progress.",
      "Bannière à accent rouge pour les erreurs qui bloquent la progression.",
    ],
    keywords: ["alert banner error", "alerte bannière erreur"],
    build: alert(
      "danger",
      ["There are 2 errors on this page", "Il y a 2 erreurs sur cette page"],
      [
        "Correct the highlighted fields before you continue.",
        "Corrigez les champs en évidence avant de continuer.",
      ],
    ),
  },
  {
    id: "web-buttons",
    group: "web",
    name: ["Buttons", "Boutons"],
    description: [
      "Primary, secondary, danger, and link-style buttons.",
      "Boutons principal, secondaire, de danger et de style lien.",
    ],
    keywords: ["button action", "bouton action"],
    build(k) {
      button(k, 0, 0, 160, 48, k.t("Continue", "Continuer"));
      button(k, 180, 0, 160, 48, k.t("Cancel", "Annuler"), "secondary");
      button(k, 360, 0, 160, 48, k.t("Delete", "Supprimer"), "danger");
      link(k, 540, 12, 160, k.t("Go back", "Retour"));
    },
  },
  {
    id: "web-call-to-action",
    group: "web",
    name: ["Start now button", "Bouton Commencer"],
    description: [
      "Prominent call to action that starts a service task.",
      "Appel à l’action bien visible qui lance une tâche de service.",
    ],
    keywords: [
      "call to action supertask start",
      "appel à l’action tâche commencer",
    ],
    build(k) {
      button(k, 0, 0, 240, 60, k.t("Start now  ›", "Commencer  ›"), "cta", {
        fontSize: 18,
        bold: true,
      });
      hint(
        k,
        0,
        76,
        360,
        k.t("It takes about 20 minutes.", "Cela prend environ 20 minutes."),
      );
    },
  },
  {
    id: "web-text-field",
    group: "web",
    name: ["Text field", "Champ de texte"],
    description: [
      "Label, hint, and input for a single answer.",
      "Étiquette, indice et champ pour une réponse unique.",
    ],
    keywords: ["form input label hint", "formulaire champ étiquette indice"],
    build(k) {
      strong(k, 0, 0, 460, k.t("Full name", "Nom complet"));
      hint(
        k,
        0,
        30,
        460,
        k.t(
          "Enter your name as it appears on your ID.",
          "Inscrivez votre nom tel qu’il figure sur votre pièce d’identité.",
        ),
      );
      field(k, 0, 60, 460, 48);
    },
  },
  {
    id: "web-error-field",
    group: "web",
    name: ["Field with error", "Champ avec erreur"],
    description: [
      "Error message and accent that explain how to fix an answer.",
      "Message d’erreur et accent qui expliquent comment corriger une réponse.",
    ],
    keywords: ["form validation error", "formulaire validation erreur"],
    build(k) {
      panel(k, 0, 0, 10, 134, WEB.error);
      strong(k, 30, 0, 440, k.t("Date of birth", "Date de naissance"));
      // White on red reads on either theme's board; red text alone cannot.
      k.card(
        30,
        32,
        440,
        42,
        k.t(
          "Error: Enter a real date of birth",
          "Erreur : Entrez une date de naissance réelle",
        ),
        {
          color: WEB.error,
          textColor: WEB.white,
          bold: true,
          fontSize: 15,
          autoFontSize: false,
          textAlign: "left",
        },
      );
      field(k, 30, 86, 440, 48, "31/02/1990");
    },
  },
  {
    id: "web-radio-group",
    group: "web",
    name: ["Radio buttons", "Boutons radio"],
    description: [
      "A question with one answer to choose.",
      "Une question avec une seule réponse à choisir.",
    ],
    keywords: ["form radio choice", "formulaire radio choix"],
    build(k) {
      strong(
        k,
        0,
        0,
        480,
        k.t("Do you already have an account?", "Avez-vous déjà un compte?"),
      );
      [
        ["Yes", "Oui"],
        ["No", "Non"],
      ].forEach((text, n) =>
        widget(k, "wf-radio", 0, 40 + n * 44, 300, 36, k.t(...text), {
          textAlign: "left",
        }),
      );
    },
  },
  {
    id: "web-checkbox-group",
    group: "web",
    name: ["Checkboxes", "Cases à cocher"],
    description: [
      "A question with several answers to choose.",
      "Une question avec plusieurs réponses possibles.",
    ],
    keywords: ["form checkbox multiple", "formulaire case à cocher multiple"],
    build(k) {
      strong(
        k,
        0,
        0,
        480,
        k.t(
          "Which services are you interested in?",
          "Quels services vous intéressent?",
        ),
      );
      [
        ["Home delivery", "Livraison à domicile"],
        ["Online support", "Soutien en ligne"],
        ["Newsletter", "Infolettre"],
      ].forEach((text, n) =>
        widget(k, "wf-checkbox", 0, 40 + n * 44, 340, 36, k.t(...text), {
          textAlign: "left",
        }),
      );
    },
  },
  {
    id: "web-select",
    group: "web",
    name: ["Select field", "Liste déroulante"],
    description: [
      "Label and dropdown for a long list of options.",
      "Étiquette et liste déroulante pour une longue liste d’options.",
    ],
    keywords: ["form select dropdown", "formulaire liste déroulante"],
    build(k) {
      strong(k, 0, 0, 400, k.t("Region", "Région"));
      widget(
        k,
        "wf-dropdown",
        0,
        32,
        400,
        48,
        k.t("Select a region", "Choisissez une région"),
        { textAlign: "left" },
      );
    },
  },
  {
    id: "web-date-input",
    group: "web",
    name: ["Date input", "Champ de date"],
    description: [
      "Separate day, month, and year fields.",
      "Champs distincts pour le jour, le mois et l’année.",
    ],
    keywords: ["form date birth", "formulaire date naissance"],
    build(k) {
      strong(k, 0, 0, 400, k.t("Date of birth", "Date de naissance"));
      hint(
        k,
        0,
        28,
        400,
        k.t("For example, 27 3 2007", "Par exemple, 27 3 2007"),
      );
      [
        [0, 80, ["Day", "Jour"]],
        [100, 80, ["Month", "Mois"]],
        [200, 120, ["Year", "Année"]],
      ].forEach(([x, w, name]) => {
        label(k, x, 60, w, k.t(...name), { fontSize: 14 });
        field(k, x, 90, w, 48);
      });
    },
  },
  {
    id: "web-file-upload",
    group: "web",
    name: ["File upload", "Téléversement de fichier"],
    description: [
      "Label, accepted formats, and a choose file button.",
      "Étiquette, formats acceptés et bouton pour choisir un fichier.",
    ],
    keywords: [
      "form upload attachment document",
      "formulaire téléverser pièce jointe document",
    ],
    build(k) {
      strong(k, 0, 0, 480, k.t("Proof of address", "Preuve d’adresse"));
      hint(
        k,
        0,
        30,
        480,
        k.t(
          "PDF, JPG or PNG, 10 MB maximum",
          "PDF, JPG ou PNG, 10 Mo au maximum",
        ),
      );
      button(
        k,
        0,
        64,
        200,
        44,
        k.t("Choose file", "Choisir un fichier"),
        "secondary",
        {
          fontSize: 15,
        },
      );
      hint(k, 220, 76, 260, k.t("No file chosen", "Aucun fichier choisi"));
    },
  },
  {
    id: "web-breadcrumb",
    group: "web",
    name: ["Breadcrumb", "Fil d’Ariane"],
    description: [
      "Trail of links showing where the page sits.",
      "Suite de liens qui situe la page.",
    ],
    keywords: ["breadcrumb navigation trail", "fil d’ariane navigation"],
    build(k) {
      panel(k, 0, 0, 720, 50, WEB.white);
      link(
        k,
        20,
        14,
        680,
        k.t(
          "Home  >  Services  >  Membership plans",
          "Accueil  >  Services  >  Forfaits d’adhésion",
        ),
        { fontSize: 15 },
      );
    },
  },
  {
    id: "web-card",
    group: "web",
    name: ["Service card", "Carte de service"],
    description: [
      "Image placeholder, linked title, and summary.",
      "Espace pour image, titre avec lien et résumé.",
    ],
    keywords: ["card tile", "carte tuile"],
    build(k) {
      panel(k, 0, 0, 300, 340);
      widget(k, "wf-image", 0, 0, 300, 160);
      link(k, 20, 180, 260, k.t("Membership plans", "Forfaits d’adhésion"), {
        fontSize: 18,
        bold: true,
      });
      label(
        k,
        20,
        240,
        260,
        k.t(
          "Find out if you are eligible and how to apply.",
          "Découvrez si vous êtes admissible et comment présenter une demande.",
        ),
        { fontSize: 15 },
      );
    },
  },
  {
    id: "web-page-details",
    group: "web",
    name: ["Page details", "Détails de la page"],
    description: [
      "Report a problem button and date modified.",
      "Bouton pour signaler un problème et date de modification.",
    ],
    keywords: [
      "report problem date modified",
      "signaler problème date de modification",
    ],
    build(k) {
      panel(k, 0, 0, 720, 130, WEB.light);
      button(
        k,
        20,
        20,
        400,
        44,
        k.t(
          "Report a problem or mistake on this page",
          "Signaler un problème ou une erreur sur cette page",
        ),
        "secondary",
        { fontSize: 14 },
      );
      label(
        k,
        20,
        84,
        680,
        k.t("Date modified: 2026-09-26", "Date de modification : 2026-09-26"),
        { fontSize: 14 },
      );
    },
  },
  {
    id: "web-stepper",
    group: "web",
    name: ["Progress stepper", "Indicateur d’étapes"],
    description: [
      "Numbered steps showing progress through a form.",
      "Étapes numérotées qui montrent la progression dans un formulaire.",
    ],
    keywords: [
      "progress steps indicator form",
      "progression étapes indicateur formulaire",
    ],
    build(k) {
      stepper(
        k,
        [
          [["Eligibility", "Admissibilité"], "done"],
          [["Personal information", "Renseignements personnels"], "current"],
          [["Review", "Vérification"], "next"],
          [["Submit", "Soumission"], "next"],
        ],
        {
          done: [WEB.green, WEB.white],
          current: [WEB.navy, WEB.white],
          next: [WEB.white, WEB.text],
        },
      );
    },
  },
  {
    id: "web-details",
    group: "web",
    name: ["Expandable details", "Détails extensibles"],
    description: [
      "A summary link that reveals more information.",
      "Un lien sommaire qui affiche plus de renseignements.",
    ],
    keywords: [
      "details disclosure accordion expand",
      "détails divulgation accordéon",
    ],
    build(k) {
      widget(k, "triangle", 0, 6, 16, 14, "", {
        color: WEB.link,
        rotation: 90,
      });
      link(
        k,
        26,
        0,
        560,
        k.t("Who can apply", "Qui peut présenter une demande"),
      );
      panel(k, 0, 40, 600, 110, WEB.white);
      panel(k, 0, 40, 10, 110, "#cccccc");
      label(
        k,
        30,
        56,
        550,
        k.t(
          "You can apply if you are 18 or older and live in the service area.",
          "Vous pouvez présenter une demande si vous avez 18 ans ou plus et habitez dans la zone desservie.",
        ),
        { fontSize: 15 },
      );
    },
  },
  {
    id: "web-data-table",
    group: "web",
    name: ["Data table", "Tableau de données"],
    description: [
      "Captioned table with a header row.",
      "Tableau avec légende et rangée d’en-tête.",
    ],
    keywords: ["table data rows", "tableau données rangées"],
    build(k) {
      strong(
        k,
        0,
        0,
        720,
        k.t("Service centre hours", "Heures des centres de service"),
        {
          fontSize: 18,
        },
      );
      k.table(0, 40, 720, [
        [
          k.t("Office", "Bureau"),
          k.t("Hours", "Heures"),
          k.t("Appointments", "Rendez-vous"),
        ],
        [
          k.t("Downtown", "Centre-ville"),
          k.t("8:30 to 16:30", "8 h 30 à 16 h 30"),
          k.t("Recommended", "Recommandés"),
        ],
        [
          k.t("North end", "Secteur nord"),
          k.t("8:30 to 16:00", "8 h 30 à 16 h"),
          k.t("Walk-in welcome", "Sans rendez-vous"),
        ],
        [
          k.t("Riverside", "Bord de l’eau"),
          k.t("9:00 to 16:00", "9 h à 16 h"),
          k.t("Required", "Obligatoires"),
        ],
      ]);
    },
  },
  // Wireframe kits.
  {
    id: "wf-login",
    group: "wireframe",
    name: ["Sign-in form", "Formulaire de connexion"],
    description: [
      "Email, password, remember me, and sign-in button.",
      "Courriel, mot de passe, mémorisation et bouton de connexion.",
    ],
    keywords: [
      "login sign in authentication",
      "connexion ouvrir une session authentification",
    ],
    build(k) {
      panel(k, 0, 0, 360, 420, wire.surface);
      strong(k, 30, 24, 300, k.t("Sign in", "Connexion"), { fontSize: 24 });
      label(k, 30, 80, 300, k.t("Email", "Courriel"), { fontSize: 14 });
      field(k, 30, 104, 300, 44, "name@example.com", { textColor: WEB.hint });
      label(k, 30, 164, 300, k.t("Password", "Mot de passe"), { fontSize: 14 });
      field(k, 30, 188, 300, 44, "********");
      widget(
        k,
        "wf-checkbox",
        30,
        248,
        300,
        36,
        k.t("Remember me", "Se souvenir de moi"),
        {
          textAlign: "left",
        },
      );
      widget(k, "wf-button", 30, 300, 300, 48, k.t("Sign in", "Se connecter"), {
        color: wire.primary,
        fontSize: 16,
      });
      link(
        k,
        30,
        368,
        300,
        k.t("Forgot your password?", "Mot de passe oublié?"),
        {
          fontSize: 14,
          textAlign: "center",
        },
      );
    },
  },
  {
    id: "wf-signup",
    group: "wireframe",
    name: ["Sign-up form", "Formulaire d’inscription"],
    description: [
      "Account creation with terms acceptance.",
      "Création de compte avec acceptation des conditions.",
    ],
    keywords: ["register create account", "inscription créer un compte"],
    build(k) {
      panel(k, 0, 0, 360, 500, wire.surface);
      strong(k, 30, 24, 300, k.t("Create an account", "Créer un compte"), {
        fontSize: 24,
      });
      [
        ["Full name", "Nom complet"],
        ["Email", "Courriel"],
        ["Password", "Mot de passe"],
      ].forEach((name, n) => {
        label(k, 30, 80 + n * 84, 300, k.t(...name), { fontSize: 14 });
        field(k, 30, 104 + n * 84, 300, 44);
      });
      widget(
        k,
        "wf-checkbox",
        30,
        340,
        300,
        36,
        k.t(
          "I accept the terms of use",
          "J’accepte les conditions d’utilisation",
        ),
        { textAlign: "left", fontSize: 14 },
      );
      widget(
        k,
        "wf-button",
        30,
        396,
        300,
        48,
        k.t("Create account", "Créer le compte"),
        {
          color: wire.primary,
          fontSize: 16,
        },
      );
      link(
        k,
        30,
        456,
        300,
        k.t("Already registered? Sign in", "Déjà inscrit? Connectez-vous"),
        {
          fontSize: 14,
          textAlign: "center",
        },
      );
    },
  },
  {
    id: "wf-site-header",
    group: "wireframe",
    name: ["Site header", "En-tête de site"],
    description: [
      "Logo, navigation links, search, and sign in.",
      "Logo, liens de navigation, recherche et connexion.",
    ],
    keywords: [
      "header navigation menu top bar",
      "en-tête navigation menu barre",
    ],
    build(k) {
      panel(k, 0, 0, 960, 72, wire.surface);
      // A labelled box: an image placeholder has no room for its label here.
      widget(k, "rectangle", 20, 12, 120, 48, k.t("Logo", "Logo"), {
        color: wire.muted,
        textAlign: "center",
      });
      [
        ["Home", "Accueil"],
        ["Services", "Services"],
        ["About", "À propos"],
        ["Contact", "Contact"],
      ].forEach((name, n) =>
        label(k, 170 + n * 100, 24, 90, k.t(...name), { textColor: wire.ink }),
      );
      widget(k, "wf-search", 600, 14, 220, 44, k.t("Search", "Rechercher"), {
        textAlign: "left",
        textColor: WEB.hint,
      });
      widget(k, "wf-button", 840, 14, 100, 44, k.t("Sign in", "Connexion"), {
        color: wire.primary,
        fontSize: 14,
      });
    },
  },
  {
    id: "wf-footer",
    group: "wireframe",
    name: ["Site footer", "Pied de page de site"],
    description: [
      "Three link columns and a copyright line.",
      "Trois colonnes de liens et une ligne de droits d’auteur.",
    ],
    keywords: ["footer links bottom", "pied de page liens bas"],
    build(k) {
      panel(k, 0, 0, 960, 200, wire.muted);
      [
        [
          ["Services", "Services"],
          ["Apply", "Présenter une demande"],
          ["Check status", "Vérifier l’état"],
        ],
        [
          ["Help", "Aide"],
          ["Contact us", "Nous joindre"],
          ["Accessibility", "Accessibilité"],
        ],
        [
          ["About", "À propos"],
          ["Privacy", "Confidentialité"],
          ["Terms", "Conditions"],
        ],
      ].forEach(([heading, ...links], c) => {
        strong(k, 40 + c * 300, 24, 260, k.t(...heading), {
          textColor: wire.ink,
        });
        links.forEach((name, r) =>
          link(k, 40 + c * 300, 60 + r * 32, 260, k.t(...name), {
            fontSize: 15,
            textColor: wire.ink,
          }),
        );
      });
      hint(
        k,
        40,
        156,
        880,
        k.t("© 2026 Example service", "© 2026 Service exemple"),
      );
    },
  },
  {
    id: "wf-hero",
    group: "wireframe",
    name: ["Hero section", "Section vedette"],
    description: [
      "Headline, summary, two actions, and an image.",
      "Titre, résumé, deux actions et une image.",
    ],
    keywords: ["hero banner landing", "bannière vedette accueil"],
    build(k) {
      panel(k, 0, 0, 960, 360, wire.muted);
      strong(
        k,
        40,
        60,
        440,
        k.t(
          "Renew your membership online",
          "Renouvelez votre adhésion en ligne",
        ),
        { fontSize: 34, textColor: wire.ink },
      );
      label(
        k,
        40,
        170,
        440,
        k.t(
          "Most people can apply in about 20 minutes.",
          "La plupart des gens peuvent présenter une demande en 20 minutes environ.",
        ),
        { fontSize: 18, textColor: wire.ink },
      );
      widget(
        k,
        "wf-button",
        40,
        260,
        180,
        52,
        k.t("Get started", "Commencer"),
        {
          color: wire.primary,
          fontSize: 16,
        },
      );
      widget(
        k,
        "wf-button",
        240,
        260,
        180,
        52,
        k.t("Learn more", "En savoir plus"),
        {
          fontSize: 16,
        },
      );
      widget(k, "wf-image", 520, 40, 400, 280);
    },
  },
  {
    id: "wf-card-grid",
    group: "wireframe",
    name: ["Card grid", "Grille de cartes"],
    description: [
      "Three content cards in a row.",
      "Trois cartes de contenu alignées.",
    ],
    keywords: ["cards tiles grid", "cartes tuiles grille"],
    build(k) {
      [
        ["Apply", "Présenter une demande"],
        ["Check status", "Vérifier l’état"],
        ["Get help", "Obtenir de l’aide"],
      ].forEach((name, n) =>
        widget(k, "wf-card", n * 300, 0, 280, 240, k.t(...name), {
          fontSize: 16,
        }),
      );
    },
  },
  {
    id: "wf-data-table",
    group: "wireframe",
    name: ["Data table with filters", "Tableau de données avec filtres"],
    description: [
      "Search, filter, table, and pagination.",
      "Recherche, filtre, tableau et pagination.",
    ],
    keywords: [
      "table grid list filter pagination",
      "tableau grille liste filtre pagination",
    ],
    build(k) {
      widget(
        k,
        "wf-search",
        0,
        0,
        300,
        44,
        k.t("Search cases", "Rechercher des dossiers"),
        {
          textAlign: "left",
          textColor: WEB.hint,
        },
      );
      widget(
        k,
        "wf-dropdown",
        320,
        0,
        220,
        44,
        k.t("Status: all", "État : tous"),
        {
          textAlign: "left",
        },
      );
      k.table(0, 64, 760, [
        [
          k.t("Case", "Dossier"),
          k.t("Applicant", "Demandeur"),
          k.t("Status", "État"),
          k.t("Updated", "Mis à jour"),
        ],
        ["A-1024", "M. Tremblay", k.t("In review", "En examen"), "2026-09-21"],
        ["A-1025", "J. Singh", k.t("Approved", "Approuvé"), "2026-09-22"],
        [
          "A-1026",
          "L. Nguyen",
          k.t("Needs information", "Renseignements requis"),
          "2026-09-23",
        ],
        ["A-1027", "S. Okafor", k.t("Submitted", "Soumis"), "2026-09-24"],
        ["A-1028", "É. Roy", k.t("In review", "En examen"), "2026-09-25"],
      ]);
      widget(k, "wf-pagination", 0, 324, 260, 40);
    },
  },
  {
    id: "wf-avatar-list",
    group: "wireframe",
    name: ["List with avatars", "Liste avec avatars"],
    description: [
      "People or items with a name and supporting detail.",
      "Personnes ou éléments avec un nom et un détail.",
    ],
    keywords: [
      "list people contacts avatar",
      "liste personnes contacts avatar",
    ],
    build(k) {
      [
        ["Amira Haddad", ["Product owner", "Responsable de produit"]],
        ["Luc Gagnon", ["Service designer", "Concepteur de services"]],
        ["Priya Raman", ["Developer", "Développeuse"]],
        ["Tom Whitefeather", ["Policy advisor", "Conseiller en politiques"]],
      ].forEach(([name, role], n) => {
        const y = n * 80;
        panel(k, 0, y, 480, 72, wire.surface);
        widget(k, "wf-avatar", 12, y + 10, 52, 52);
        strong(k, 80, y + 12, 380, name, { textColor: wire.ink });
        hint(k, 80, y + 40, 380, k.t(...role));
      });
    },
  },
  {
    id: "wf-search-results",
    group: "wireframe",
    name: ["Search results", "Résultats de recherche"],
    description: [
      "Search field, result count, and three results.",
      "Champ de recherche, nombre de résultats et trois résultats.",
    ],
    keywords: ["search results page", "résultats de recherche page"],
    build(k) {
      widget(
        k,
        "wf-search",
        0,
        0,
        640,
        48,
        k.t("membership renewal", "renouvellement d’adhésion"),
        {
          textAlign: "left",
        },
      );
      hint(k, 0, 64, 640, k.t("3 results", "3 résultats"));
      [
        ["Renew a membership", "Renouveler une adhésion"],
        ["Membership fees", "Frais d’adhésion"],
        ["Check your application status", "Vérifier l’état de votre demande"],
      ].forEach((title, n) => {
        const y = 100 + n * 110;
        link(k, 0, y, 640, k.t(...title), { fontSize: 18 });
        hint(k, 0, y + 28, 640, "example.org/membership", { fontSize: 13 });
        widget(k, "wf-paragraph", 0, y + 52, 640, 40);
      });
    },
  },
  {
    id: "wf-empty-state",
    group: "wireframe",
    name: ["Empty state", "État vide"],
    description: [
      "Illustration, message, and first action.",
      "Illustration, message et première action.",
    ],
    keywords: ["empty no results zero state", "vide aucun résultat"],
    build(k) {
      panel(k, 0, 0, 480, 330, wire.surface);
      widget(k, "wf-image", 170, 30, 140, 100);
      strong(
        k,
        40,
        150,
        400,
        k.t("No applications yet", "Aucune demande pour l’instant"),
        {
          fontSize: 22,
          textAlign: "center",
          textColor: wire.ink,
        },
      );
      label(
        k,
        40,
        190,
        400,
        k.t(
          "Start an application and it will appear here.",
          "Commencez une demande et elle s’affichera ici.",
        ),
        { fontSize: 15, textAlign: "center", textColor: wire.ink },
      );
      widget(
        k,
        "wf-button",
        130,
        250,
        220,
        48,
        k.t("Start an application", "Commencer une demande"),
        {
          color: wire.primary,
          fontSize: 15,
        },
      );
    },
  },
  {
    id: "wf-stepper",
    group: "wireframe",
    name: ["Multi-step progress", "Progression en plusieurs étapes"],
    description: [
      "Wireframe progress indicator for a task flow.",
      "Indicateur de progression pour un parcours de tâches.",
    ],
    keywords: ["steps wizard progress", "étapes assistant progression"],
    build(k) {
      stepper(
        k,
        [
          [["Account", "Compte"], "done"],
          [["Details", "Détails"], "current"],
          [["Documents", "Documents"], "next"],
          [["Confirm", "Confirmation"], "next"],
        ],
        {
          done: [wire.muted, wire.ink],
          current: [wire.primary, wire.ink],
          next: [wire.surface, wire.ink],
        },
      );
    },
  },
  {
    id: "wf-toast",
    group: "wireframe",
    name: ["Toast notification", "Notification éphémère"],
    description: [
      "Short confirmation with an undo action.",
      "Brève confirmation avec action d’annulation.",
    ],
    keywords: ["toast snackbar message notification", "message notification"],
    build(k) {
      panel(k, 0, 0, 400, 70, wire.ink);
      label(
        k,
        24,
        22,
        260,
        k.t("Changes saved", "Modifications enregistrées"),
        {
          textColor: WEB.white,
        },
      );
      link(k, 290, 22, 90, k.t("Undo", "Annuler"), {
        textColor: WEB.white,
        textAlign: "right",
        bold: true,
      });
    },
  },
  {
    id: "wf-modal-dialog",
    group: "wireframe",
    name: ["Confirmation dialog", "Boîte de confirmation"],
    description: [
      "Modal with title, message, and two actions.",
      "Fenêtre modale avec titre, message et deux actions.",
    ],
    keywords: [
      "modal dialog popup confirm",
      "modale boîte de dialogue confirmer",
    ],
    build(k) {
      // Built from plain parts: the modal dialog shape draws placeholder
      // buttons and a title bar, which would show behind real ones.
      k.shape("rectangle", 0, 0, 420, 260, "", { color: wire.surface });
      k.line(0, 72, 420, 72, { color: SHAPE_COLORS.LINE, lineWidth: 1 });
      for (const [x1, y1, x2, y2] of [
        [384, 22, 400, 38],
        [400, 22, 384, 38],
      ])
        k.line(x1, y1, x2, y2, { color: wire.ink, lineWidth: 1.5 });
      strong(
        k,
        24,
        20,
        320,
        k.t("Delete this draft?", "Supprimer cette ébauche?"),
        {
          fontSize: 20,
          textColor: wire.ink,
        },
      );
      label(
        k,
        24,
        90,
        372,
        k.t(
          "Your answers will be removed. This cannot be undone.",
          "Vos réponses seront supprimées. Cette action est irréversible.",
        ),
        { fontSize: 15, textColor: wire.ink },
      );
      widget(k, "wf-button", 120, 190, 130, 44, k.t("Cancel", "Annuler"), {
        fontSize: 15,
      });
      widget(k, "wf-button", 266, 190, 130, 44, k.t("Delete", "Supprimer"), {
        color: wire.primary,
        fontSize: 15,
      });
    },
  },
  {
    id: "wf-settings",
    group: "wireframe",
    name: ["Settings with toggles", "Paramètres avec interrupteurs"],
    description: [
      "Preference list with on and off switches.",
      "Liste de préférences avec interrupteurs.",
    ],
    keywords: [
      "settings preferences switch toggle",
      "paramètres préférences interrupteur",
    ],
    build(k) {
      panel(k, 0, 0, 420, 250, wire.surface);
      strong(k, 20, 16, 380, k.t("Notifications", "Notifications"), {
        fontSize: 20,
        textColor: wire.ink,
      });
      [
        ["Email updates", "Mises à jour par courriel"],
        ["Text messages", "Messages texte"],
        ["Appointment reminders", "Rappels de rendez-vous"],
        ["Newsletter", "Bulletin"],
      ].forEach((name, n) =>
        widget(k, "wf-toggle", 20, 60 + n * 44, 380, 36, k.t(...name), {
          textAlign: "left",
        }),
      );
    },
  },
  {
    id: "wf-mobile-header",
    group: "wireframe",
    name: ["Mobile app header", "En-tête d’application mobile"],
    description: [
      "Status bar and title bar for a phone screen.",
      "Barre d’état et barre de titre pour un écran de téléphone.",
    ],
    keywords: ["mobile app bar header", "mobile barre application en-tête"],
    build(k) {
      panel(k, 0, 0, 360, 30, wire.muted);
      label(k, 16, 6, 100, "9:41", {
        fontSize: 12,
        bold: true,
        textColor: wire.ink,
      });
      widget(k, "wf-navbar", 0, 30, 360, 56, k.t("My account", "Mon compte"), {
        fontSize: 17,
        bold: true,
      });
    },
  },
  {
    id: "wf-tab-bar",
    group: "wireframe",
    name: ["Mobile tab bar", "Barre d’onglets mobile"],
    description: [
      "Bottom navigation with four destinations.",
      "Navigation inférieure avec quatre destinations.",
    ],
    keywords: [
      "bottom navigation tabs mobile",
      "navigation inférieure onglets mobile",
    ],
    build(k) {
      widget(k, "wf-tabbar", 0, 0, 360, 64);
      // One label under each of the bar's four tabs.
      [
        ["Home", "Accueil"],
        ["Search", "Recherche"],
        ["Inbox", "Messages"],
        ["Profile", "Profil"],
      ].forEach((text, n) =>
        label(k, n * 90, 34, 90, k.t(...text), {
          fontSize: 12,
          textAlign: "center",
        }),
      );
      k.shape("terminator", 130, 70, 100, 10, "", { color: wire.ink });
    },
  },
  {
    id: "wf-comments",
    group: "wireframe",
    name: ["Comment thread", "Fil de commentaires"],
    description: [
      "Comments with avatars and a reply field.",
      "Commentaires avec avatars et champ de réponse.",
    ],
    keywords: [
      "comments discussion thread reply",
      "commentaires discussion fil réponse",
    ],
    build(k) {
      [
        [
          "Amira",
          ["Can we simplify step 2?", "Peut-on simplifier l’étape 2?"],
          k.t("10:02", "10 h 02"),
        ],
        [
          "Luc",
          [
            "Yes, I will merge the two address fields.",
            "Oui, je vais fusionner les deux champs d’adresse.",
          ],
          k.t("10:15", "10 h 15"),
        ],
      ].forEach(([name, text, time], n) => {
        const y = n * 90;
        widget(k, "wf-avatar", 0, y, 48, 48);
        strong(k, 64, y, 300, name, { textColor: wire.ink, fontSize: 15 });
        hint(k, 380, y, 100, time, { textAlign: "right", fontSize: 13 });
        label(k, 64, y + 26, 416, k.t(...text), {
          fontSize: 15,
          textColor: wire.ink,
        });
      });
      field(k, 0, 190, 360, 44, k.t("Write a reply", "Écrire une réponse"), {
        textColor: WEB.hint,
      });
      widget(k, "wf-button", 380, 190, 100, 44, k.t("Post", "Publier"), {
        color: wire.primary,
        fontSize: 15,
      });
    },
  },
  // Diagram building blocks.
  {
    id: "uml-class-box",
    group: "diagram",
    name: ["UML class", "Classe UML"],
    description: [
      "Name, attributes, and operations compartments.",
      "Compartiments pour le nom, les attributs et les opérations.",
    ],
    keywords: ["uml class object model", "uml classe modèle objet"],
    build(k) {
      k.card(0, 0, 240, 50, k.t("Application", "Demande"), {
        bold: true,
        textAlign: "center",
        autoFontSize: false,
      });
      k.card(
        0,
        50,
        240,
        100,
        k.t(
          "- id: UUID\n- status: Status\n- submitted: Date",
          "- id : UUID\n- état : État\n- soumise : Date",
        ),
        {
          fontSize: 14,
          autoFontSize: false,
        },
      );
      k.card(
        0,
        150,
        240,
        80,
        k.t(
          "+ submit(): void\n+ withdraw(): void",
          "+ soumettre() : void\n+ retirer() : void",
        ),
        {
          fontSize: 14,
          autoFontSize: false,
        },
      );
    },
  },
  {
    id: "uml-sequence",
    group: "diagram",
    name: ["Sequence participants", "Participants de séquence"],
    description: [
      "Two lifelines with a request and a response.",
      "Deux lignes de vie avec une requête et une réponse.",
    ],
    keywords: [
      "uml sequence lifeline message",
      "uml séquence ligne de vie message",
    ],
    build(k) {
      [
        ["Applicant portal", "Portail du demandeur"],
        ["Case service", "Service des dossiers"],
      ].forEach((name, n) => {
        const x = n * 300;
        // Longer French names shrink to fit rather than being cut off.
        k.shape("rectangle", x, 0, 180, 50, k.t(...name), {
          textAlign: "center",
          autoFontSize: true,
          fontSize: 15,
        });
        k.line(x + 90, 50, x + 90, 360, { lineStyle: "dashed" });
        k.card(x + 80, 110, 20, 160, "", { color: PALETTE.grey });
      });
      k.line(100, 130, 380, 130, {
        endCap: "arrow",
        text: k.t("submit(application)", "soumettre(demande)"),
      });
      k.line(380, 250, 100, 250, {
        endCap: "arrow",
        lineStyle: "dashed",
        text: k.t("reference number", "numéro de référence"),
      });
    },
  },
  {
    id: "swimlanes",
    group: "diagram",
    name: ["Swimlane pair", "Paire de couloirs"],
    description: [
      "Two labelled lanes for cross-functional flows.",
      "Deux couloirs étiquetés pour les flux interfonctionnels.",
    ],
    keywords: ["swimlane lane process", "couloir processus"],
    build(k) {
      [
        ["Applicant", "Demandeur"],
        ["Service agent", "Agent de service"],
      ].forEach((name, n) => {
        k.shape("lane-header", 0, n * 120, 180, 120, k.t(...name), {
          color: n ? PALETTE.green : PALETTE.blue,
          autoFontSize: false,
        });
        k.card(180, n * 120, 780, 120, "", { color: PALETTE.white });
      });
    },
  },
  {
    id: "decision-branch",
    group: "diagram",
    name: ["Decision branch", "Embranchement de décision"],
    description: [
      "A decision with Yes and No outcomes.",
      "Une décision avec des issues Oui et Non.",
    ],
    keywords: ["flowchart decision yes no", "logigramme décision oui non"],
    build(k) {
      const choice = k.shape(
        "diamond",
        170,
        0,
        220,
        120,
        k.t("Eligible?", "Admissible?"),
        {
          color: PALETTE.yellow,
          autoFontSize: false,
          fontSize: 15,
        },
      );
      const yes = k.shape(
        "bpmn-task",
        0,
        240,
        200,
        80,
        k.t("Send approval", "Envoyer l’approbation"),
        {
          color: PALETTE.green,
        },
      );
      const no = k.shape(
        "bpmn-task",
        360,
        240,
        200,
        80,
        k.t("Ask for more information", "Demander plus de renseignements"),
        {
          color: PALETTE.orange,
        },
      );
      k.connect(choice, yes, { lineType: "elbow", text: k.t("Yes", "Oui") });
      k.connect(choice, no, { lineType: "elbow", text: k.t("No", "Non") });
    },
  },
  {
    id: "bpmn-mini",
    group: "diagram",
    name: ["BPMN mini process", "Mini processus BPMN"],
    description: [
      "Start, task, gateway, and end events connected.",
      "Événements de début et de fin, tâche et passerelle reliés.",
    ],
    keywords: ["bpmn process flow gateway", "bpmn processus flux passerelle"],
    build(k) {
      const start = k.shape("start-event", 0, 15, 60, 60, "");
      const task = k.shape(
        "bpmn-task",
        120,
        0,
        160,
        90,
        k.t("Review application", "Examiner la demande"),
      );
      const gate = k.shape("gateway-exclusive", 340, 10, 70, 70, "");
      const end = k.shape("end-event", 560, 15, 60, 60, "");
      k.connect(start, task);
      k.connect(task, gate);
      k.connect(gate, end, { text: k.t("Complete", "Complète") });
    },
  },
  {
    id: "legend",
    group: "diagram",
    name: ["Legend", "Légende"],
    description: [
      "Color key explaining what each color means.",
      "Clé de couleurs qui explique chaque couleur.",
    ],
    keywords: ["legend key colors", "légende clé couleurs"],
    build(k) {
      panel(k, 0, 0, 260, 220, PALETTE.white);
      strong(k, 20, 16, 220, k.t("Legend", "Légende"), {
        textColor: PALETTE.ink,
      });
      [
        [PALETTE.yellow, ["Customer action", "Action du client"]],
        [PALETTE.blue, ["Frontstage", "Avant-scène"]],
        [PALETTE.green, ["Backstage", "Arrière-scène"]],
        [PALETTE.orange, ["Pain point", "Point de friction"]],
      ].forEach(([color, name], n) => {
        k.card(20, 56 + n * 40, 30, 30, "", { color });
        label(k, 64, 60 + n * 40, 180, k.t(...name), {
          fontSize: 15,
          textColor: PALETTE.ink,
        });
      });
    },
  },
  {
    id: "architecture-tier",
    group: "diagram",
    name: ["Architecture tier", "Niveau d’architecture"],
    description: [
      "API, application service, and database connected.",
      "API, service applicatif et base de données reliés.",
    ],
    keywords: [
      "architecture api database service",
      "architecture api base de données service",
    ],
    build(k) {
      const api = k.shape(
        "api",
        0,
        10,
        200,
        90,
        k.t("API gateway", "Passerelle API"),
      );
      const app = k.shape(
        "container",
        280,
        10,
        200,
        90,
        k.t("Case service", "Service des dossiers"),
      );
      const db = k.shape(
        "cylinder",
        560,
        0,
        160,
        110,
        k.t("Case database", "Base de données des dossiers"),
      );
      k.connect(api, app);
      k.connect(app, db);
    },
  },
  {
    id: "blueprint-lanes",
    group: "diagram",
    name: ["Service blueprint lanes", "Couloirs de plan de service"],
    description: [
      "Five labelled lanes with interaction and visibility lines.",
      "Cinq couloirs étiquetés avec lignes d’interaction et de visibilité.",
    ],
    keywords: [
      "service blueprint lanes line of visibility",
      "plan de service couloirs ligne de visibilité",
    ],
    build(k) {
      const lanes = [
        [["Physical evidence", "Éléments tangibles"], PALETTE.grey],
        [["Customer actions", "Actions du client"], PALETTE.yellow],
        [["Frontstage", "Avant-scène"], PALETTE.blue],
        [["Backstage", "Arrière-scène"], PALETTE.green],
        [["Support processes", "Processus de soutien"], PALETTE.purple],
      ];
      lanes.forEach(([name, color], n) => {
        k.shape("lane-header", 0, n * 120, 180, 100, k.t(...name), {
          color,
          autoFontSize: false,
        });
        k.card(190, n * 120, 770, 100, "", { color: PALETTE.white });
      });
      [
        [2, ["Line of interaction", "Ligne d’interaction"]],
        [3, ["Line of visibility", "Ligne de visibilité"]],
        [4, ["Line of internal interaction", "Ligne d’interaction interne"]],
      ].forEach(([n, text]) =>
        k.line(0, n * 120 - 10, 960, n * 120 - 10, {
          lineStyle: "dashed",
          text: k.t(...text),
          fontSize: 13,
        }),
      );
    },
  },
  // Facilitation kits.
  {
    id: "dot-voting",
    group: "facilitation",
    name: ["Dot voting set", "Jeu de votes par points"],
    description: [
      "Five voting dots for each participant.",
      "Cinq points de vote pour chaque participant.",
    ],
    keywords: ["dot vote voting prioritize", "vote points prioriser"],
    build(k) {
      strong(k, 0, 0, 300, k.t("5 votes each", "5 votes chacun"), {
        fontSize: 15,
        textColor: PALETTE.ink,
      });
      for (let n = 0; n < 5; n++)
        k.shape("ellipse", n * 40, 36, 30, 30, "", { color: "#2b4380" });
    },
  },
  {
    id: "timebox",
    group: "facilitation",
    name: ["Timebox card", "Carte de temps limité"],
    description: [
      "Shows the time allowed for the current activity.",
      "Indique le temps alloué à l’activité en cours.",
    ],
    keywords: ["timebox timer duration", "temps limité minuterie durée"],
    build(k) {
      panel(k, 0, 0, 240, 150, PALETTE.white);
      label(k, 20, 16, 200, k.t("Timebox", "Temps limité"), {
        fontSize: 15,
        textColor: PALETTE.muted,
      });
      strong(k, 20, 44, 200, "10:00", { fontSize: 44, textColor: PALETTE.ink });
      label(k, 20, 110, 200, k.t("Silent writing", "Écriture en silence"), {
        fontSize: 15,
        textColor: PALETTE.ink,
      });
    },
  },
  {
    id: "parking-lot",
    group: "facilitation",
    name: ["Parking lot", "Stationnement d’idées"],
    description: [
      "Space for important topics to revisit later.",
      "Espace pour les sujets importants à revoir plus tard.",
    ],
    keywords: ["parking lot later topics", "sujets plus tard stationnement"],
    build(k) {
      panel(k, 0, 0, 420, 320, PALETTE.white);
      strong(k, 20, 16, 380, k.t("Parking lot", "Stationnement d’idées"), {
        fontSize: 22,
        textColor: PALETTE.ink,
      });
      hint(
        k,
        20,
        52,
        380,
        k.t(
          "Topics worth discussing after this session.",
          "Sujets à aborder après cette séance.",
        ),
      );
      k.note(
        20,
        110,
        k.t(
          "Budget for user research",
          "Budget pour la recherche auprès des utilisateurs",
        ),
        {
          w: 180,
          h: 180,
        },
      );
      k.note(220, 110, k.t("Add a topic", "Ajoutez un sujet"), {
        w: 180,
        h: 180,
      });
    },
  },
  {
    id: "how-might-we",
    group: "facilitation",
    name: ["How might we notes", "Notes Comment pourrions-nous"],
    description: [
      "Prompts that reframe problems as opportunities.",
      "Amorces qui transforment les problèmes en occasions.",
    ],
    keywords: ["how might we hmw reframe", "comment pourrions-nous recadrer"],
    build(k) {
      [
        [
          "How might we reduce waiting time?",
          "Comment pourrions-nous réduire l’attente?",
        ],
        [
          "How might we make status clear?",
          "Comment pourrions-nous clarifier l’état du dossier?",
        ],
        ["How might we ...?", "Comment pourrions-nous ...?"],
      ].forEach((text, n) =>
        k.note(n * 200, 0, k.t(...text), { color: PALETTE.blue }),
      );
    },
  },
  {
    id: "agenda-card",
    group: "facilitation",
    name: ["Agenda card", "Carte d’ordre du jour"],
    description: [
      "Timed agenda table for a session.",
      "Tableau d’ordre du jour minuté pour une séance.",
    ],
    keywords: ["agenda schedule session", "ordre du jour horaire séance"],
    build(k) {
      strong(k, 0, 0, 560, k.t("Agenda", "Ordre du jour"), {
        fontSize: 22,
        textColor: PALETTE.ink,
      });
      k.table(
        0,
        44,
        560,
        [
          [
            k.t("Time", "Heure"),
            k.t("Activity", "Activité"),
            k.t("Lead", "Animation"),
          ],
          [
            k.t("9:00", "9 h"),
            k.t("Welcome and check-in", "Accueil et tour de table"),
            "Amira",
          ],
          [
            k.t("9:15", "9 h 15"),
            k.t("Explore the problem", "Explorer le problème"),
            "Luc",
          ],
          [
            k.t("9:45", "9 h 45"),
            k.t("Generate ideas", "Générer des idées"),
            "Priya",
          ],
          [
            k.t("10:15", "10 h 15"),
            k.t("Decide next steps", "Décider des prochaines étapes"),
            "Amira",
          ],
        ],
        { columnWidths: [100, 320, 140] },
      );
    },
  },
  {
    id: "roles-card",
    group: "facilitation",
    name: ["Session roles", "Rôles de la séance"],
    description: [
      "Facilitator, timekeeper, and note taker duties.",
      "Tâches de l’animateur, du gardien du temps et du preneur de notes.",
    ],
    keywords: [
      "roles facilitator timekeeper note taker",
      "rôles animateur gardien du temps preneur de notes",
    ],
    build(k) {
      [
        [
          ["Facilitator", "Animation"],
          [
            "Guides the process and keeps everyone included.",
            "Guide le processus et veille à inclure tout le monde.",
          ],
          PALETTE.blue,
        ],
        [
          ["Timekeeper", "Gardien du temps"],
          [
            "Tracks each timebox and signals the last minute.",
            "Suit chaque période et signale la dernière minute.",
          ],
          PALETTE.green,
        ],
        [
          ["Note taker", "Prise de notes"],
          [
            "Captures decisions, actions, and open questions.",
            "Consigne les décisions, les actions et les questions.",
          ],
          PALETTE.purple,
        ],
      ].forEach(([role, duty, color], n) => {
        k.card(n * 220, 0, 200, 160, "", { color });
        strong(k, n * 220 + 16, 16, 168, k.t(...role), {
          textColor: PALETTE.ink,
        });
        label(k, n * 220 + 16, 50, 168, k.t(...duty), {
          fontSize: 14,
          textColor: PALETTE.ink,
        });
      });
    },
  },
  {
    id: "mood-meter",
    group: "facilitation",
    name: ["Check-in mood meter", "Météo d’accueil"],
    description: [
      "Participants mark how they are arriving.",
      "Les participants indiquent leur état d’esprit à l’arrivée.",
    ],
    keywords: [
      "check-in mood emotion icebreaker",
      "accueil humeur émotion brise-glace",
    ],
    build(k) {
      strong(
        k,
        0,
        0,
        360,
        k.t("How are you arriving today?", "Comment arrivez-vous aujourd’hui?"),
        { fontSize: 18, textColor: PALETTE.ink },
      );
      [
        ["emotion-high", ["Energized", "Plein d’énergie"], PALETTE.green],
        ["emotion-neutral", ["Okay", "Correct"], PALETTE.yellow],
        ["emotion-low", ["Tired", "Fatigué"], PALETTE.orange],
      ].forEach(([key, name, color], n) => {
        k.shape(key, n * 130, 44, 90, 90, "", { color });
        label(k, n * 130 - 10, 144, 110, k.t(...name), {
          fontSize: 14,
          textAlign: "center",
          textColor: PALETTE.ink,
        });
      });
    },
  },
  {
    id: "decision-log",
    group: "facilitation",
    name: ["Decision log", "Registre des décisions"],
    description: [
      "Record decisions with rationale and owner.",
      "Consigner les décisions, leur justification et le responsable.",
    ],
    keywords: ["decision log record", "registre décisions consigner"],
    build(k) {
      strong(k, 0, 0, 720, k.t("Decision log", "Registre des décisions"), {
        fontSize: 22,
        textColor: PALETTE.ink,
      });
      k.table(
        0,
        44,
        720,
        [
          [
            k.t("Date", "Date"),
            k.t("Decision", "Décision"),
            k.t("Rationale", "Justification"),
            k.t("Owner", "Responsable"),
          ],
          [
            "2026-09-26",
            k.t(
              "Pilot online renewal in two regions",
              "Mettre à l’essai le renouvellement en ligne dans deux régions",
            ),
            k.t(
              "Limits risk while we learn",
              "Limite le risque pendant l’apprentissage",
            ),
            "Amira",
          ],
          ["", "", "", ""],
          ["", "", "", ""],
        ],
        {
          columnWidths: [110, 260, 220, 130],
          rowHeights: [40, 70, 40, 40],
          h: 190,
        },
      );
    },
  },
  {
    id: "persona-card",
    group: "delivery",
    name: ["Persona card", "Fiche persona"],
    description: [
      "A person to design for: context, goals, pain points, and a quote.",
      "Une personne pour qui concevoir : contexte, objectifs, irritants et citation.",
    ],
    keywords: [
      "persona user profile service design research archetype",
      "persona profil utilisateur conception de services recherche archétype",
    ],
    build(k) {
      panel(k, 0, 0, 380, 300, PALETTE.white);
      widget(k, "wf-avatar", 20, 20, 64, 64);
      strong(k, 100, 22, 260, k.t("Amira", "Amira"), {
        textColor: PALETTE.ink,
      });
      label(
        k,
        100,
        52,
        260,
        k.t(
          "First-time applicant, works shifts",
          "Première demande, horaires variables",
        ),
        { fontSize: 14, textColor: PALETTE.muted },
      );
      [
        [
          104,
          ["Goals", "Objectifs"],
          [
            "Finish the application on a break",
            "Terminer la demande pendant une pause",
          ],
        ],
        [
          176,
          ["Pain points", "Irritants"],
          [
            "Unsure which documents to have ready",
            "Ne sait pas quels documents préparer",
          ],
        ],
      ].forEach(([y, title, text]) => {
        strong(k, 20, y, 340, k.t(...title), {
          fontSize: 14,
          textColor: PALETTE.ink,
        });
        label(k, 20, y + 26, 340, k.t(...text), {
          fontSize: 15,
          textColor: PALETTE.ink,
        });
      });
      label(
        k,
        20,
        256,
        340,
        k.t("“I will finish this later.”", "« Je terminerai plus tard. »"),
        { fontSize: 15, italic: true, textColor: PALETTE.muted },
      );
    },
  },
  {
    id: "journey-stage",
    group: "delivery",
    name: ["Journey stage", "Étape du parcours"],
    description: [
      "One stage of a journey map: doing, feeling, touchpoints, pain points, and opportunities.",
      "Une étape d’une carte de parcours : actions, émotions, points de contact, irritants et pistes.",
    ],
    keywords: [
      "journey map stage column touchpoints pain points opportunities service design",
      "carte de parcours étape colonne points de contact irritants pistes conception de services",
    ],
    build(k) {
      k.card(0, 0, 280, 60, k.t("Stage: Apply", "Étape : Demande"), {
        color: PALETTE.navy,
        textColor: "#ffffff",
        bold: true,
        textAlign: "center",
        textValign: "middle",
      });
      [
        [
          ["Doing", "Actions"],
          ["Fills in the online form", "Remplit le formulaire en ligne"],
          PALETTE.blue,
        ],
        [
          ["Thinking and feeling", "Pensées et émotions"],
          ["Worried about mistakes", "Craint de se tromper"],
          PALETTE.purple,
        ],
        [
          ["Touchpoints", "Points de contact"],
          ["Website, phone line", "Site Web, ligne téléphonique"],
          PALETTE.white,
        ],
        [
          ["Pain points", "Irritants"],
          ["The session times out", "La session expire"],
          PALETTE.red,
        ],
        [
          ["Opportunities", "Pistes"],
          [
            "Save progress automatically",
            "Enregistrer la progression automatiquement",
          ],
          PALETTE.green,
        ],
      ].forEach(([title, text, color], n) => {
        const y = 76 + n * 96;
        panel(k, 0, y, 280, 84, color);
        strong(k, 14, y + 8, 252, k.t(...title), {
          fontSize: 13,
          textColor: PALETTE.ink,
        });
        label(k, 14, y + 34, 252, k.t(...text), {
          fontSize: 15,
          textColor: PALETTE.ink,
        });
      });
    },
  },
  {
    id: "user-story-card",
    group: "delivery",
    name: ["User story card", "Fiche de récit utilisateur"],
    description: [
      "A user story with acceptance criteria and an estimate.",
      "Un récit utilisateur avec ses critères d’acceptation et son estimation.",
    ],
    keywords: [
      "user story card agile backlog acceptance criteria estimate points",
      "récit utilisateur fiche agile carnet critères d’acceptation estimation points",
    ],
    build(k) {
      panel(k, 0, 0, 380, 300, PALETTE.yellow);
      strong(k, 20, 18, 260, "US-142", {
        fontSize: 14,
        textColor: PALETTE.muted,
      });
      k.shape("ellipse", 316, 14, 48, 48, "5", {
        color: PALETTE.white,
        textAlign: "center",
        bold: true,
        fontSize: 18,
      });
      label(
        k,
        20,
        66,
        340,
        k.t(
          "As a first-time applicant, I want to save my application so that I can finish it later.",
          "En tant que personne qui fait une première demande, je veux enregistrer ma demande afin de la terminer plus tard.",
        ),
        { textColor: PALETTE.ink },
      );
      strong(
        k,
        20,
        170,
        340,
        k.t("Acceptance criteria", "Critères d’acceptation"),
        { fontSize: 14, textColor: PALETTE.ink },
      );
      label(
        k,
        20,
        196,
        340,
        k.t(
          "Given I am signed in, when I select Save, my answers are kept for 30 days.",
          "Si je suis connecté et que je choisis Enregistrer, mes réponses sont conservées 30 jours.",
        ),
        { fontSize: 14, textColor: PALETTE.ink },
      );
    },
  },
  {
    id: "definition-of-done",
    group: "delivery",
    name: ["Definition of done", "Définition de terminé"],
    description: [
      "A shared checklist every backlog item meets before it is done.",
      "Une liste commune que chaque élément du carnet respecte avant d’être terminé.",
    ],
    keywords: [
      "definition of done checklist quality agile scrum",
      "définition de terminé liste de vérification qualité agile scrum",
    ],
    build(k) {
      panel(k, 0, 0, 380, 320, PALETTE.white);
      strong(
        k,
        20,
        18,
        340,
        k.t("Definition of done", "Définition de terminé"),
        {
          textColor: PALETTE.ink,
        },
      );
      [
        ["Code reviewed by a teammate", "Code révisé par un collègue"],
        ["Automated tests pass", "Tests automatisés réussis"],
        ["Meets WCAG 2.1 AA", "Conforme aux WCAG 2.1 AA"],
        ["Available in English and French", "Offert en français et en anglais"],
        [
          "Accepted by the product owner",
          "Accepté par la responsable du produit",
        ],
      ].forEach((text, n) =>
        widget(k, "wf-checkbox", 20, 64 + n * 48, 340, 36, k.t(...text), {
          textAlign: "left",
        }),
      );
    },
  },
  {
    id: "double-diamond",
    group: "delivery",
    name: ["Double diamond", "Double diamant"],
    description: [
      "The design process model: discover and define the problem, then develop and deliver the solution.",
      "Le modèle de conception : découvrir et définir le problème, puis développer et livrer la solution.",
    ],
    keywords: [
      "double diamond design process model discover define develop deliver diverge converge service design",
      "double diamant processus de conception modèle découvrir définir développer livrer diverger converger conception de services",
    ],
    build(k) {
      [
        [0, PALETTE.blue, ["Discover", "Découvrir"], ["Define", "Définir"]],
        [380, PALETTE.green, ["Develop", "Développer"], ["Deliver", "Livrer"]],
      ].forEach(([x, color, first, second]) => {
        k.shape("diamond", x, 0, 360, 220, "", { color });
        label(k, x + 30, 98, 140, k.t(...first), {
          bold: true,
          textAlign: "center",
          textColor: PALETTE.ink,
        });
        label(k, x + 190, 98, 140, k.t(...second), {
          bold: true,
          textAlign: "center",
          textColor: PALETTE.ink,
        });
      });
      [
        [0, ["The right problem", "Le bon problème"]],
        [380, ["The right solution", "La bonne solution"]],
      ].forEach(([x, text]) =>
        label(k, x, 236, 360, k.t(...text), {
          fontSize: 14,
          textAlign: "center",
          textColor: PALETTE.ink,
        }),
      );
    },
  },
  {
    id: "hypothesis-card",
    group: "delivery",
    name: ["Hypothesis card", "Fiche d’hypothèse"],
    description: [
      "A testable assumption with the result and the signal you expect.",
      "Une hypothèse vérifiable avec le résultat et le signal attendus.",
    ],
    keywords: [
      "hypothesis assumption experiment lean test learn measure",
      "hypothèse supposition expérience lean tester apprendre mesurer",
    ],
    build(k) {
      panel(k, 0, 0, 380, 300, PALETTE.purple);
      strong(k, 20, 18, 340, k.t("Hypothesis", "Hypothèse"), {
        textColor: PALETTE.ink,
      });
      [
        [
          ["We believe", "Nous croyons que"],
          ["a checklist before the form", "une liste avant le formulaire"],
        ],
        [
          ["will result in", "mènera à"],
          [
            "more applications finished in one sitting",
            "plus de demandes terminées en une seule séance",
          ],
        ],
        [
          ["We will know when", "Nous le saurons quand"],
          ["80% finish within a day", "80 % les terminent en un jour"],
        ],
      ].forEach(([lead, text], n) => {
        strong(k, 20, 60 + n * 78, 340, k.t(...lead), {
          fontSize: 14,
          textColor: PALETTE.ink,
        });
        label(k, 20, 84 + n * 78, 340, k.t(...text), {
          fontSize: 15,
          textColor: PALETTE.ink,
        });
      });
    },
  },
  {
    id: "working-agreement",
    group: "delivery",
    name: ["Team working agreement", "Entente de travail d’équipe"],
    description: [
      "How the team agrees to work together, ready to adapt.",
      "La façon dont l’équipe convient de travailler ensemble, à adapter.",
    ],
    keywords: [
      "working agreement team charter norms collaboration agile",
      "entente de travail charte d’équipe normes collaboration agile",
    ],
    build(k) {
      panel(k, 0, 0, 380, 300, PALETTE.green);
      strong(
        k,
        20,
        18,
        340,
        k.t("Team working agreement", "Entente de travail d’équipe"),
        { textColor: PALETTE.ink },
      );
      [
        [
          "Cameras optional, voices welcome",
          "Caméra facultative, voix bienvenues",
        ],
        ["Decisions go in the decision log", "Les décisions vont au registre"],
        ["Core hours 10:00 to 15:00", "Heures communes de 10 h à 15 h"],
        ["Ask for help early", "Demander de l’aide tôt"],
        [
          "Work in English or French, your choice",
          "Travailler en français ou en anglais, au choix",
        ],
      ].forEach((text, n) =>
        label(k, 20, 62 + n * 44, 340, `• ${k.t(...text)}`, {
          fontSize: 15,
          textColor: PALETTE.ink,
        }),
      );
    },
  },
];
const groupNames = new Map(COMPONENT_GROUPS.map((g) => [g.id, g.name]));
const searchText = new Map(
  COMPONENTS.map((c) => [
    c.id,
    searchIndex(
      [
        ...c.name,
        ...c.description,
        ...c.keywords,
        ...groupNames.get(c.group),
      ].join(" "),
    ),
  ]),
);
// Every query word must match in either language, ignoring accents.
export function searchComponents(query = "", group = "") {
  const words = searchWords(query);
  return COMPONENTS.filter(
    (c) =>
      (!group || c.group === group) &&
      words.every((word) => matchesWord(searchText.get(c.id), word)),
  );
}
// Builds fresh objects for one component near the origin, grouped together.
// Text in a dark neutral or link color that sits on the bare board, not
// on a light shape, drops its color and follows the theme, so it stays
// readable on the dark theme's board. Status colors such as errors stay.
const DARK_INK = new Set(
  [WEB.text, WEB.hint, WEB.link, PALETTE.ink].map((c) => c.toLowerCase()),
);
function themeInk(items) {
  const fills = [];
  for (const i of items)
    if (["rect", "ellipse", "note", "table"].includes(i.type)) fills.push(i);
    else if (i.type === "text" && DARK_INK.has(i.textColor?.toLowerCase())) {
      const x = i.x + Math.min(i.w, 40) / 2,
        y = i.y + i.h / 2;
      if (
        !fills.some(
          (f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h,
        )
      )
        delete i.textColor;
    }
}
export function componentItems(id, lang = "en") {
  const component = COMPONENTS.find((c) => c.id === id);
  if (!component) throw Error("Unknown component.");
  const k = createKit(lang);
  component.build(k);
  // Like templates, the content keeps its language when the interface
  // changes, so it is read and exported in that language.
  for (const i of k.items)
    if (
      i.lang === undefined &&
      (i.text || i.alt || i.cells?.some((row) => row.some(Boolean)))
    )
      i.lang = lang === "fr" ? "fr-CA" : "en";
  themeInk(k.items);
  if (k.items.length > 1) k.group(k.items);
  updateConnectors(k.items);
  return k.items;
}
